import { z } from 'zod';
import { providerCardSchema, type ProviderCard } from './index';

export const NEARBY_LIFETIME_MS = 300_000;
export const nearbyTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const nearbyOfferSchema = z.object({
  version: z.literal(1), token: nearbyTokenSchema,
  cardId: z.string().min(1).max(100),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).strict();
export type NearbyOffer = z.infer<typeof nearbyOfferSchema>;
const resolutionSchema = z.object({
  offer: nearbyOfferSchema, publication: z.literal('published'), card: providerCardSchema,
}).strict();

export type NearbyErrorCode = 'invalid_link' | 'invalid_response' | 'unavailable' | 'expired' |
  'offline' | 'storage' | 'busy' | 'no_consent' | 'cancelled';
export class NearbyError extends Error {
  constructor(public readonly code: NearbyErrorCode) { super(code); this.name = 'NearbyError'; }
}

function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new NearbyError('invalid_link');
  return url.origin;
}

/** Separate from profile/QR parsing. Canonical spelling also rejects URL-normalized traversal. */
export function parseNearbyOfferLink(input: string, trustedOrigin: string): string | null {
  try {
    if (input.length > 2048) return null;
    const origin = httpsOrigin(trustedOrigin);
    const url = new URL(input);
    const token = /^\/nearby\/([0-9a-f]{64})$/.exec(url.pathname)?.[1];
    if (!token || url.origin !== origin || input !== `${origin}/nearby/${token}`) return null;
    return token;
  } catch { return null; }
}

export function nearbyOfferLink(token: string, trustedOrigin: string): string {
  if (!nearbyTokenSchema.safeParse(token).success) throw new NearbyError('invalid_link');
  return `${httpsOrigin(trustedOrigin)}/nearby/${token}`;
}

export function assertNearbyOfferTime(offer: NearbyOffer, now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(offer.issuedAt) ||
      !Number.isSafeInteger(offer.expiresAt) || offer.expiresAt - offer.issuedAt !== NEARBY_LIFETIME_MS ||
      offer.issuedAt > now) throw new NearbyError('invalid_response');
  if (now >= offer.expiresAt) throw new NearbyError('expired');
}

/** A trusted configured adapter returns data, never a redirect or a sender-provided API address. */
export type NearbyResolver = (token: string) => Promise<unknown>;
export interface NearbySavedCard {
  card: ProviderCard; note: string; favorite: boolean; order: number;
  savedAt: string; refreshedAt: string; lastOpenedAt: string | null;
}
export interface NearbyWalletSnapshot {
  cards: NearbySavedCard[];
  decisions: Record<string, 'saved' | 'declined'>;
}
export interface NearbyWalletStore {
  read(): Promise<NearbyWalletSnapshot>;
  /** Serialize against other wallet edits; atomically commit the whole update or reject without writing. */
  commit(update: (current: NearbyWalletSnapshot) => NearbyWalletSnapshot): Promise<void>;
}
export type NearbyReceipt = 'preview' | 'duplicate' | 'already_saved' | 'busy';
type Preview = { offer: NearbyOffer; card: ProviderCard };
type Pending = { token: string; preview?: Preview };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class NearbyConsentSession {
  private pending?: Pending;
  private active = false;
  private generation = 0;
  constructor(private readonly options: {
    trustedOrigin: string; resolve: NearbyResolver; wallet: NearbyWalletStore; now: () => number;
  }) { httpsOrigin(options.trustedOrigin); }

  /** Detached values: a preview consumer cannot change the card/token used by Save. */
  get preview(): Preview | null { return this.pending?.preview ? clone(this.pending.preview) : null; }
  get pendingToken(): string | null { return this.pending?.token ?? null; }

  /** Invalidates uncommitted async work. It cannot undo a transaction already committed to storage. */
  dismiss(): void { this.generation++; this.pending = undefined; }

  private current(generation: number): void {
    if (generation !== this.generation) throw new NearbyError('cancelled');
  }
  private async resolve(token: string, generation: number): Promise<Preview> {
    let raw: unknown;
    try { raw = await this.options.resolve(token); }
    catch { this.current(generation); throw new NearbyError('offline'); }
    this.current(generation);
    if (raw === null) throw new NearbyError('unavailable');
    const parsed = resolutionSchema.safeParse(raw);
    if (!parsed.success || parsed.data.offer.token !== token || parsed.data.offer.cardId !== parsed.data.card.id)
      throw new NearbyError('invalid_response');
    assertNearbyOfferTime(parsed.data.offer, this.options.now());
    return { offer: parsed.data.offer, card: parsed.data.card };
  }
  private async read(): Promise<NearbyWalletSnapshot> {
    try { return await this.options.wallet.read(); }
    catch { throw new NearbyError('storage'); }
  }
  private async commit(update: (current: NearbyWalletSnapshot) => NearbyWalletSnapshot): Promise<void> {
    try { await this.options.wallet.commit(update); }
    catch (error) {
      if (error instanceof NearbyError) throw error;
      throw new NearbyError('storage');
    }
  }
  private clearTerminal(error: unknown, generation: number): never {
    if (generation === this.generation && this.pending?.preview) {
      try { assertNearbyOfferTime(this.pending.preview.offer, this.options.now()); }
      catch (expired) { this.pending = undefined; throw expired; }
    }
    if (generation === this.generation && error instanceof NearbyError &&
        ['expired', 'unavailable', 'invalid_response'].includes(error.code)) this.pending = undefined;
    throw error;
  }

  async receive(input: string): Promise<NearbyReceipt> {
    const token = parseNearbyOfferLink(input, this.options.trustedOrigin);
    if (!token) throw new NearbyError('invalid_link');
    if (this.active) return 'busy';
    if (this.pending && this.pending.token !== token) return 'busy';
    if (this.pending?.preview) return 'duplicate';
    this.active = true;
    const generation = this.generation;
    try {
      const wallet = await this.read(); this.current(generation);
      if (wallet.decisions[token]) return 'duplicate';
      this.pending = { token };
      const preview = await this.resolve(token, generation);
      if (wallet.cards.some(entry => entry.card.id === preview.card.id)) {
        this.pending = undefined;
        return 'already_saved';
      }
      this.pending.preview = preview;
      return 'preview';
    } catch (error) { return this.clearTerminal(error, generation); }
    finally { this.active = false; }
  }

  async accept(token: string): Promise<void> {
    if (this.active) throw new NearbyError('busy');
    const pending = this.pending;
    if (!pending?.preview || pending.token !== token) throw new NearbyError('no_consent');
    this.active = true;
    const generation = this.generation;
    try {
      assertNearbyOfferTime(pending.preview.offer, this.options.now());
      // Fresh online publication check, even if an earlier preview is cached.
      const latest = await this.resolve(token, generation);
      const original = pending.preview.offer;
      if (latest.offer.cardId !== original.cardId || latest.offer.issuedAt !== original.issuedAt ||
          latest.offer.expiresAt !== original.expiresAt) throw new NearbyError('invalid_response');
      await this.commit(current => {
        this.current(generation);
        const now = this.options.now();
        assertNearbyOfferTime(latest.offer, now); // Includes time spent waiting for the storage transaction.
        const next = clone(current);
        if (next.decisions[token] === 'declined') throw new NearbyError('no_consent');
        if (!next.cards.some(entry => entry.card.id === latest.card.id)) {
          const timestamp = new Date(now).toISOString();
          next.cards.push({ card: clone(latest.card), note: '', favorite: false,
            order: Math.max(-1, ...next.cards.map(entry => entry.order)) + 1,
            savedAt: timestamp, refreshedAt: timestamp, lastOpenedAt: null });
        }
        next.decisions[token] = 'saved';
        return next;
      });
      this.pending = undefined;
    } catch (error) { this.clearTerminal(error, generation); }
    finally { this.active = false; }
  }

  async decline(token: string): Promise<void> {
    if (this.active) throw new NearbyError('busy');
    if (this.pending?.token !== token) throw new NearbyError('no_consent');
    this.active = true;
    const generation = this.generation;
    try {
      await this.commit(current => {
        this.current(generation);
        return { ...clone(current), decisions: { ...current.decisions,
          [token]: current.decisions[token] ?? 'declined' } };
      });
      this.pending = undefined;
    } finally { this.active = false; }
  }
}
