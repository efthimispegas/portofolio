/** Isolated local harness. No HTTP route, database, production issuer or identity service. */
import { providerCardSchema, type ProviderCard } from './index';
import { assertNearbyOfferTime, NEARBY_LIFETIME_MS, NearbyError, nearbyOfferLink,
  nearbyTokenSchema, type NearbyOffer, type NearbyWalletSnapshot, type NearbyWalletStore } from './nearby';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export class SyntheticNearbyOffers {
  private readonly cards = new Map<string, ProviderCard>();
  private readonly offers = new Map<string, NearbyOffer>();
  online = true;
  constructor(private readonly options: { trustedOrigin: string; now: () => number; token: () => string }) {}
  publish(card: ProviderCard): void {
    const parsed = providerCardSchema.parse(card);
    if (!parsed.isDemo) throw new Error('Synthetic cards only');
    this.cards.set(parsed.id, copy(parsed));
  }
  unpublish(id: string): void { this.cards.delete(id); }
  /** Deliberately no registration, session, role or sender identity input. */
  issue(cardId: string): string {
    if (!this.online) throw new NearbyError('offline');
    if (!this.cards.has(cardId)) throw new NearbyError('unavailable');
    const token = this.options.token();
    if (!nearbyTokenSchema.safeParse(token).success || this.offers.has(token)) throw new Error('Invalid token generator');
    const issuedAt = this.options.now();
    const offer: NearbyOffer = { version: 1, token, cardId, issuedAt, expiresAt: issuedAt + NEARBY_LIFETIME_MS };
    assertNearbyOfferTime(offer, issuedAt);
    const url = nearbyOfferLink(token, this.options.trustedOrigin);
    this.offers.set(token, offer);
    return url;
  }
  resolve = async (token: string): Promise<unknown> => {
    if (!this.online) throw new NearbyError('offline');
    const offer = this.offers.get(token);
    if (!offer) return null;
    const card = this.cards.get(offer.cardId);
    if (!card) return null;
    // Return expired metadata too: client independently checks time before consent and Save.
    return copy({ offer, publication: 'published', card });
  };
}

/** Serial, atomic in-memory transactions for synthetic tests; production persistence remains gated. */
export class SyntheticNearbyWallet implements NearbyWalletStore {
  private value: NearbyWalletSnapshot;
  private queue: Promise<void> = Promise.resolve();
  failNextCommit = false;
  constructor(initial: NearbyWalletSnapshot = { cards: [], decisions: {} }) { this.value = copy(initial); }
  async read(): Promise<NearbyWalletSnapshot> { await this.queue; return copy(this.value); }
  commit(update: (current: NearbyWalletSnapshot) => NearbyWalletSnapshot): Promise<void> {
    const result = this.queue.then(() => {
      if (this.failNextCommit) { this.failNextCommit = false; throw new Error('Synthetic storage failure'); }
      const next = update(copy(this.value));
      this.value = copy(next);
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
