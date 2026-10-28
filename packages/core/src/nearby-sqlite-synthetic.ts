/** Explicitly initialized, demo-only storage. Never opens or migrates the customer's wallet. */
import { z } from 'zod';
import { providerCardSchema } from './index';
import { nearbyTokenSchema, type NearbyWalletSnapshot, type NearbyWalletStore } from './nearby';

export type NearbySQLValue = string | number | null;
export interface NearbySQLConnection {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...parameters: NearbySQLValue[]): Promise<T | null>;
  runAsync(sql: string, ...parameters: NearbySQLValue[]): Promise<{ changes: number }>;
}
export interface NearbySQLDatabase extends NearbySQLConnection {
  withExclusiveTransactionAsync(task: (transaction: NearbySQLConnection) => Promise<void>): Promise<void>;
}

const snapshotSchema = z.object({
  cards: z.array(z.object({
    card: providerCardSchema.refine(card => card.isDemo),
    note: z.string().max(4000), favorite: z.boolean(), order: z.number().int(),
    savedAt: z.iso.datetime({ offset: true }), refreshedAt: z.iso.datetime({ offset: true }),
    lastOpenedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).refine(cards => new Set(cards.map(entry => entry.card.id)).size === cards.length),
  decisions: z.record(nearbyTokenSchema, z.enum(['saved', 'declined'])),
}).strict();
type Row = { schema_version: number; revision: number; snapshot: string };
export class SyntheticNearbyStorageError extends Error {
  constructor() { super('Synthetic nearby wallet is unavailable or invalid'); this.name = 'SyntheticNearbyStorageError'; }
}
const select = 'SELECT schema_version,revision,snapshot FROM nearby_synthetic_wallet WHERE singleton=1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function validate(value: unknown): NearbyWalletSnapshot {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) throw new SyntheticNearbyStorageError();
  return result.data;
}
function decode(row: Row | null): NearbyWalletSnapshot {
  if (!row || row.schema_version !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 0)
    throw new SyntheticNearbyStorageError();
  try { return validate(JSON.parse(row.snapshot)); }
  catch { throw new SyntheticNearbyStorageError(); }
}

export class SyntheticSQLiteNearbyWallet implements NearbyWalletStore {
  private initialized = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly database: NearbySQLDatabase) {}

  private serialize(task: () => Promise<void>): Promise<void> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  /** The caller supplies a separate synthetic database. Importing/constructing performs no SQL. */
  initialize(): Promise<void> {
    return this.serialize(async () => {
      await this.database.withExclusiveTransactionAsync(async transaction => {
        await transaction.execAsync(`CREATE TABLE IF NOT EXISTS nearby_synthetic_wallet (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>=0),
          snapshot TEXT NOT NULL
        )`);
        await transaction.runAsync(
          'INSERT OR IGNORE INTO nearby_synthetic_wallet(singleton,schema_version,revision,snapshot) VALUES(1,1,0,?)',
          JSON.stringify({ cards: [], decisions: {} }),
        );
        decode(await transaction.getFirstAsync<Row>(select));
      });
      this.initialized = true;
    });
  }

  async read(): Promise<NearbyWalletSnapshot> {
    await this.queue;
    if (!this.initialized) throw new SyntheticNearbyStorageError();
    return decode(await this.database.getFirstAsync<Row>(select));
  }

  commit(update: (current: NearbyWalletSnapshot) => NearbyWalletSnapshot): Promise<void> {
    return this.serialize(async () => {
      if (!this.initialized) throw new SyntheticNearbyStorageError();
      await this.database.withExclusiveTransactionAsync(async transaction => {
        const row = await transaction.getFirstAsync<Row>(select);
        const current = decode(row);
        const next = validate(update(clone(current)));
        const revision = row!.revision;
        if (!Number.isSafeInteger(revision + 1)) throw new SyntheticNearbyStorageError();
        const result = await transaction.runAsync(
          'UPDATE nearby_synthetic_wallet SET snapshot=?,revision=revision+1 WHERE singleton=1 AND schema_version=1 AND revision=?',
          JSON.stringify(next), revision,
        );
        if (result.changes !== 1) throw new SyntheticNearbyStorageError();
      });
    });
  }
}
