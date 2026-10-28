import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoCards } from './index';
import { NearbyConsentSession, NearbyError, NEARBY_LIFETIME_MS, parseNearbyOfferLink } from './nearby';
import { SyntheticNearbyOffers } from './nearby-synthetic';
import { SyntheticSQLiteNearbyWallet, SyntheticNearbyStorageError,
  type NearbySQLDatabase, type NearbySQLConnection } from './nearby-sqlite-synthetic';

const origin = 'https://portofolio.invalid';
function driver(raw: DatabaseSync): NearbySQLDatabase {
  const connection: NearbySQLConnection = {
    async execAsync(sql) { raw.exec(sql); },
    async getFirstAsync<T>(sql: string, ...parameters: (string | number | null)[]) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async runAsync(sql, ...parameters) {
      return { changes: Number(raw.prepare(sql).run(...parameters).changes) };
    },
  };
  return { ...connection, async withExclusiveTransactionAsync(task) {
    raw.exec('BEGIN IMMEDIATE');
    try { await task(connection); raw.exec('COMMIT'); }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
}
async function fixture(action: (value: {
  raw: DatabaseSync; db: NearbySQLDatabase; wallet: SyntheticSQLiteNearbyWallet;
  reopen: () => SyntheticSQLiteNearbyWallet;
}) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'portofolio-nearby-sqlite-'));
  const path = join(directory, 'portofolio-nearby-synthetic-v1.db');
  let raw = new DatabaseSync(path);
  const db = driver(raw), wallet = new SyntheticSQLiteNearbyWallet(db);
  try {
    await action({ raw, db, wallet, reopen: () => {
      raw.close(); raw = new DatabaseSync(path);
      return new SyntheticSQLiteNearbyWallet(driver(raw));
    } });
  } finally { raw.close(); rmSync(directory, { recursive: true }); }
}
function flow(wallet: SyntheticSQLiteNearbyWallet) {
  let now = 1_793_000_000_000, sequence = 0;
  const offers = new SyntheticNearbyOffers({ trustedOrigin: origin, now: () => now,
    token: () => (++sequence).toString(16).padStart(64, '0') });
  offers.publish(demoCards[0]);
  const session = new NearbyConsentSession({ trustedOrigin: origin, wallet, resolve: offers.resolve, now: () => now });
  const issue = () => { const url = offers.issue(demoCards[0].id); return { url, token: parseNearbyOfferLink(url, origin)! }; };
  return { session, issue, advance: (ms: number) => { now += ms; } };
}

test('SQLite initialization is explicit, idempotent and preserves unrelated tables', async () => {
  await fixture(async ({ raw, wallet }) => {
    raw.exec("CREATE TABLE cards(id TEXT); INSERT INTO cards VALUES('unrelated-customer-data')");
    assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='nearby_synthetic_wallet'").get(), undefined);
    await assert.rejects(wallet.read(), SyntheticNearbyStorageError);
    await wallet.initialize(); await wallet.initialize();
    assert.deepEqual(await wallet.read(), { cards: [], decisions: {} });
    assert.equal((raw.prepare('SELECT id FROM cards').get() as { id: string }).id, 'unrelated-customer-data');
  });
});

test('card, decision and all local fields survive closing and reopening a real SQLite file', async () => {
  await fixture(async ({ wallet, reopen }) => {
    await wallet.initialize(); const f = flow(wallet), offer = f.issue();
    await f.session.receive(offer.url); await f.session.accept(offer.token);
    await wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry,
      note: "Πρωί — '); DROP TABLE cards; --", favorite: true, order: 4,
      lastOpenedAt: '2026-10-28T10:00:00.000Z' })) }));
    const before = await wallet.read();
    const reopened = reopen(); await reopened.initialize();
    assert.deepEqual(await reopened.read(), before);
    assert.equal((await reopened.read()).decisions[offer.token], 'saved');
  });
});

test('actual SQLite write failure rolls back both card and decision; retry saves once', async () => {
  await fixture(async ({ raw, wallet }) => {
    await wallet.initialize(); const f = flow(wallet), offer = f.issue();
    await f.session.receive(offer.url);
    raw.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON nearby_synthetic_wallet BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
    await assert.rejects(f.session.accept(offer.token), e => e instanceof NearbyError && e.code === 'storage');
    assert.deepEqual(await wallet.read(), { cards: [], decisions: {} });
    assert.ok(f.session.preview);
    raw.exec('DROP TRIGGER fail_save');
    await f.session.accept(offer.token);
    const saved = await wallet.read();
    assert.equal(saved.cards.length, 1); assert.deepEqual(saved.decisions, { [offer.token]: 'saved' });
    assert.equal(await f.session.receive(offer.url), 'duplicate');
  });
});

test('decline and replay protection persist across a database restart', async () => {
  await fixture(async ({ wallet, reopen }) => {
    await wallet.initialize(); const f = flow(wallet), offer = f.issue();
    await f.session.receive(offer.url); await f.session.decline(offer.token);
    const reopened = reopen(); await reopened.initialize();
    const next = flow(reopened);
    assert.equal(await next.session.receive(offer.url), 'duplicate');
    assert.deepEqual((await reopened.read()).cards, []);
  });
});

test('serialized SQLite commits read latest data and preserve concurrent edits', async () => {
  await fixture(async ({ wallet }) => {
    await wallet.initialize(); const f = flow(wallet), offer = f.issue();
    await f.session.receive(offer.url); await f.session.accept(offer.token);
    await Promise.all([
      wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry, note: 'Keep note' })) })),
      wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry, favorite: true })) })),
      wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry, order: 7 })) })),
    ]);
    const [entry] = (await wallet.read()).cards;
    assert.equal(entry.note, 'Keep note'); assert.equal(entry.favorite, true); assert.equal(entry.order, 7);
    const another = f.issue();
    assert.equal(await f.session.receive(another.url), 'already_saved');
    assert.deepEqual((await wallet.read()).cards, [entry]);
  });
});

test('corruption and unknown schema versions fail closed without resetting stored data', async () => {
  await fixture(async ({ raw, wallet, db }) => {
    await wallet.initialize();
    for (const [version, payload] of [[2, '{"cards":[],"decisions":{}}'], [1, 'corrupt-private-content']] as const) {
      raw.prepare('UPDATE nearby_synthetic_wallet SET schema_version=?,snapshot=?').run(version, payload);
      const before = raw.prepare('SELECT * FROM nearby_synthetic_wallet').get();
      await assert.rejects(wallet.read(), e => e instanceof SyntheticNearbyStorageError && !e.message.includes(payload));
      await assert.rejects(new SyntheticSQLiteNearbyWallet(db).initialize(), SyntheticNearbyStorageError);
      assert.deepEqual(raw.prepare('SELECT * FROM nearby_synthetic_wallet').get(), before);
    }
  });
});

test('invalid and non-demo updates cannot enter synthetic SQLite storage', async () => {
  await fixture(async ({ wallet }) => {
    await wallet.initialize(); const f = flow(wallet), offer = f.issue();
    await f.session.receive(offer.url); await f.session.accept(offer.token);
    const before = await wallet.read();
    await assert.rejects(wallet.commit(current => ({ ...current,
      cards: current.cards.map(entry => ({ ...entry, card: { ...entry.card, isDemo: false } })) })), SyntheticNearbyStorageError);
    await assert.rejects(wallet.commit(current => ({ ...current, decisions: { invalid: 'saved' } })), SyntheticNearbyStorageError);
    assert.deepEqual(await wallet.read(), before);
  });
});

test('a rejected callback cannot poison the transaction queue or persist its mutations', async () => {
  await fixture(async ({ wallet }) => {
    await wallet.initialize();
    await assert.rejects(wallet.commit(current => {
      current.decisions['a'.repeat(64)] = 'saved'; throw new Error('abort');
    }), /abort/);
    assert.deepEqual(await wallet.read(), { cards: [], decisions: {} });
    await wallet.commit(current => ({ ...current, decisions: { ['b'.repeat(64)]: 'declined' } }));
    assert.deepEqual((await wallet.read()).decisions, { ['b'.repeat(64)]: 'declined' });
  });
});

test('expiry at actual SQLite transaction execution leaves card and decision absent', async () => {
  await fixture(async ({ wallet, db }) => {
    let beforeTransaction = () => {};
    const delayed = new SyntheticSQLiteNearbyWallet({ ...db, withExclusiveTransactionAsync: async task => {
      beforeTransaction(); await db.withExclusiveTransactionAsync(task);
    } });
    await delayed.initialize();
    const f = flow(delayed), offer = f.issue();
    await f.session.receive(offer.url);
    beforeTransaction = () => f.advance(NEARBY_LIFETIME_MS);
    await assert.rejects(f.session.accept(offer.token), e => e instanceof NearbyError && e.code === 'expired');
    assert.deepEqual(await delayed.read(), { cards: [], decisions: {} });
  });
});
