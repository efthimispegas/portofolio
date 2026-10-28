import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoCards, parseCardLink } from './index';
import { NearbyConsentSession, NearbyError, NEARBY_LIFETIME_MS, nearbyOfferLink,
  parseNearbyOfferLink, type NearbyResolver, type NearbyWalletStore } from './nearby';
import { SyntheticNearbyOffers, SyntheticNearbyWallet } from './nearby-synthetic';

const origin = 'https://portofolio.invalid';
const epoch = 1_793_000_000_000;
const [cardA, cardB] = demoCards;
const error = (code: string) => (value: unknown) => value instanceof NearbyError && value.code === code;
function setup() {
  let time = epoch, counter = 0;
  const now = () => time;
  const offers = new SyntheticNearbyOffers({ trustedOrigin: origin, now,
    token: () => (++counter).toString(16).padStart(64, '0') });
  offers.publish(cardA); offers.publish(cardB);
  const wallet = new SyntheticNearbyWallet();
  const session = (store: NearbyWalletStore = wallet, resolve: NearbyResolver = offers.resolve) =>
    new NearbyConsentSession({ trustedOrigin: origin, now, wallet: store, resolve });
  return { offers, wallet, now, session, advance: (ms: number) => { time += ms; } };
}
function token(url: string) { return parseNearbyOfferLink(url, origin)!; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('nearby parser accepts only canonical HTTPS offers and never broadens QR/profile parsing', () => {
  const id = 'a'.repeat(64), good = nearbyOfferLink(id, origin);
  assert.equal(parseNearbyOfferLink(good, origin), id);
  for (const input of [good + '/', good + '?', good + '#', good + '?card=forged',
    good.replace('https:', 'http:'), good.replace('portofolio.invalid', 'evil.invalid'),
    good.replace('https://', 'https://user:password@'), good.replace('/nearby/', '/c/'),
    good.replace('/nearby/', '/a/../nearby/'), good.replace('/nearby/', '/%6eearby/'),
    good.replace(id, id.toUpperCase()), good.replace(id, 'a'.repeat(63)), ' ' + good,
    'portofolio-probe://card?payload=anything', good + 'a'.repeat(2048)]) {
    assert.equal(parseNearbyOfferLink(input, origin), null, input);
  }
  assert.equal(parseCardLink(good, origin), null);
  assert.equal(parseNearbyOfferLink(origin + '/c/' + cardA.slug, origin), null);
  assert.equal(parseNearbyOfferLink(good, 'http://portofolio.invalid'), null);
});

test('issuer offers are account-free, contain no business fields and can reach independent wallets', async () => {
  const h = setup(), url = h.offers.issue(cardA.id);
  assert.match(url, /^https:\/\/portofolio.invalid\/nearby\/[a-f0-9]{64}$/);
  const first = h.session(), secondWallet = new SyntheticNearbyWallet(), second = h.session(secondWallet);
  assert.equal(await first.receive(url), 'preview');
  assert.equal(await second.receive(url), 'preview');
  assert.deepEqual((await h.wallet.read()).cards, []);
  await first.accept(token(url)); await second.accept(token(url));
  assert.equal((await h.wallet.read()).cards[0].card.id, cardA.id);
  assert.equal((await secondWallet.read()).cards[0].card.id, cardA.id);
});

test('synthetic issuer rejects real or unpublished cards and token collisions', () => {
  const h = setup();
  assert.throws(() => h.offers.publish({ ...cardA, isDemo: false }), /Synthetic cards only/);
  h.offers.unpublish(cardA.id);
  assert.throws(() => h.offers.issue(cardA.id), error('unavailable'));
  const fixed = new SyntheticNearbyOffers({ trustedOrigin: origin, now: h.now, token: () => 'b'.repeat(64) });
  fixed.publish(cardA); fixed.issue(cardA.id);
  assert.throws(() => fixed.issue(cardA.id), /Invalid token generator/);
});

test('receive rejects unknown offers and never imports sender-authored card data', async () => {
  const h = setup(), s = h.session();
  await assert.rejects(s.receive(nearbyOfferLink('f'.repeat(64), origin)), error('unavailable'));
  const url = h.offers.issue(cardA.id);
  const original = await h.offers.resolve(token(url)) as object;
  const corruptions = [
    { ...original, publication: 'draft' },
    { ...original, ownerAFM: 'private' },
    { ...original, card: { ...cardA, id: cardB.id } },
    { ...original, offer: { version: 2 } },
  ];
  for (const bad of corruptions) {
    const s = h.session(h.wallet, async () => bad);
    await assert.rejects(s.receive(url), error('invalid_response'));
    assert.equal(s.preview, null);
  }
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('five-minute validity excludes the exact expiry instant', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  h.advance(NEARBY_LIFETIME_MS - 1);
  assert.equal(await s.receive(url), 'preview');
  h.advance(1);
  await assert.rejects(s.accept(token(url)), error('expired'));
  assert.equal(s.preview, null);
  await assert.rejects(h.session().receive(url), error('expired'));
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('Save rechecks publication and rejects revocation after preview', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  await s.receive(url); h.offers.unpublish(cardA.id);
  await assert.rejects(s.accept(token(url)), error('unavailable'));
  assert.equal(s.preview, null);
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('offline initial receipt retains only the pending offer and retries while valid', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  h.offers.online = false;
  await assert.rejects(s.receive(url), error('offline'));
  assert.equal(s.preview, null); assert.equal(s.pendingToken, token(url));
  await assert.rejects(s.accept(token(url)), error('no_consent'));
  h.offers.online = true;
  assert.equal(await s.receive(url), 'preview');
  await s.accept(token(url)); assert.equal((await h.wallet.read()).cards.length, 1);
});

test('offline at Save retains consent, but a known expired offer cannot retry offline', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  await s.receive(url); h.offers.online = false;
  await assert.rejects(s.accept(token(url)), error('offline'));
  assert.equal(s.preview?.card.id, cardA.id);
  assert.deepEqual((await h.wallet.read()).cards, []);
  h.advance(NEARBY_LIFETIME_MS);
  await assert.rejects(s.accept(token(url)), error('expired'));
  assert.equal(s.preview, null);
});

test('failed atomic Save keeps consent and retry records one card and one decision', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  await s.receive(url); h.wallet.failNextCommit = true;
  await assert.rejects(s.accept(token(url)), error('storage'));
  assert.ok(s.preview); assert.deepEqual(await h.wallet.read(), { cards: [], decisions: {} });
  await s.accept(token(url));
  const saved = await h.wallet.read();
  assert.equal(saved.cards.length, 1); assert.deepEqual(saved.decisions, { [token(url)]: 'saved' });
  assert.equal(await s.receive(url), 'duplicate');
  await assert.rejects(s.accept(token(url)), error('no_consent'));
});

test('decline is local to a wallet; failed decline retries and fresh offers can be accepted', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session();
  await s.receive(url); h.wallet.failNextCommit = true;
  await assert.rejects(s.decline(token(url)), error('storage'));
  assert.ok(s.preview);
  await s.decline(token(url));
  assert.equal(await s.receive(url), 'duplicate');
  assert.deepEqual((await h.wallet.read()).cards, []);
  const fresh = h.offers.issue(cardA.id);
  assert.equal(await s.receive(fresh), 'preview'); await s.accept(token(fresh));
  const other = h.session(new SyntheticNearbyWallet());
  assert.equal(await other.receive(url), 'preview');
});

test('a duplicate saved card preserves every local field and personal order', async () => {
  const h = setup(), s = h.session(), url = h.offers.issue(cardA.id);
  await s.receive(url); await s.accept(token(url));
  await h.wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry,
    note: 'Κάλεσε το πρωί', favorite: true, order: 7, lastOpenedAt: '2026-10-28T10:00:00.000Z' })) }));
  const before = await h.wallet.read();
  assert.equal(await s.receive(h.offers.issue(cardA.id)), 'already_saved');
  assert.deepEqual(await h.wallet.read(), before);
});

test('concurrent wallet edits during resolution are preserved by the transaction', async () => {
  const h = setup(), s = h.session(), url = h.offers.issue(cardA.id);
  await s.receive(url);
  const sameCardAddedElsewhere = h.session();
  await sameCardAddedElsewhere.receive(h.offers.issue(cardA.id));
  await sameCardAddedElsewhere.accept(sameCardAddedElsewhere.pendingToken!);
  await h.wallet.commit(current => ({ ...current, cards: current.cards.map(entry => ({ ...entry, note: 'Keep this', favorite: true, order: 3 })) }));
  const before = (await h.wallet.read()).cards;
  await s.accept(token(url));
  assert.deepEqual((await h.wallet.read()).cards, before);
});

test('busy and replacement deliveries cannot replace pending consent', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), other = h.offers.issue(cardB.id);
  const gate = deferred<unknown>(), s = h.session(h.wallet, () => gate.promise);
  const first = s.receive(url);
  assert.equal(await s.receive(other), 'busy');
  gate.resolve(await h.offers.resolve(token(url)));
  assert.equal(await first, 'preview');
  assert.equal(await s.receive(url), 'duplicate');
  assert.equal(await s.receive(other), 'busy');
  assert.equal(s.preview?.card.id, cardA.id);
});

test('dismissal invalidates late receive and Save responses without saving', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), gate = deferred<unknown>();
  const s = h.session(h.wallet, () => gate.promise);
  const first = s.receive(url); s.dismiss(); gate.resolve(await h.offers.resolve(token(url)));
  await assert.rejects(first, error('cancelled')); assert.equal(s.preview, null);
  let delay = false; const saveGate = deferred<unknown>();
  const next = h.session(h.wallet, async id => delay ? saveGate.promise : h.offers.resolve(id));
  await next.receive(url); delay = true;
  const saving = next.accept(token(url)); next.dismiss(); saveGate.resolve(await h.offers.resolve(token(url)));
  await assert.rejects(saving, error('cancelled'));
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('expiry during network or storage waits prevents a save', async () => {
  const h = setup(), url = h.offers.issue(cardA.id);
  const late = h.session(h.wallet, async id => { const raw = await h.offers.resolve(id); h.advance(NEARBY_LIFETIME_MS); return raw; });
  await assert.rejects(late.receive(url), error('expired'));
  const fresh = h.offers.issue(cardA.id);
  const slowStore: NearbyWalletStore = { read: () => h.wallet.read(), commit: update => {
    h.advance(NEARBY_LIFETIME_MS); return h.wallet.commit(update);
  } };
  const s = h.session(slowStore); await s.receive(fresh);
  await assert.rejects(s.accept(token(fresh)), error('expired'));
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('resolution cannot extend an offer or change its bound card between preview and Save', async () => {
  const h = setup(), url = h.offers.issue(cardA.id);
  let changed = false;
  const s = h.session(h.wallet, async id => {
    const raw = await h.offers.resolve(id) as { offer: { issuedAt: number; expiresAt: number } };
    if (changed) { raw.offer.issuedAt++; raw.offer.expiresAt++; }
    return raw;
  });
  await s.receive(url); changed = true; h.advance(1);
  await assert.rejects(s.accept(token(url)), error('invalid_response'));
  assert.deepEqual((await h.wallet.read()).cards, []);
});

test('preview mutation cannot change the saved card', async () => {
  const h = setup(), url = h.offers.issue(cardA.id), s = h.session(); await s.receive(url);
  s.preview!.card.displayName = 'Forged';
  await s.accept(token(url)); assert.equal((await h.wallet.read()).cards[0].card.displayName, cardA.displayName);
});
