import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Button, Linking, Platform, PlatformColor, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { demoCards } from '@mastoli/core';
import { NearbyConsentSession, NearbyError, parseNearbyOfferLink, type NearbyWalletSnapshot, type NearbyWalletStore } from '@mastoli/core/nearby';
import { SyntheticNearbyOffers } from '@mastoli/core/nearby-synthetic';
import { SyntheticSQLiteNearbyWallet } from '@mastoli/core/nearby-sqlite-synthetic';
import { syntheticNearbySQLiteDriver } from '../mobile/src/lib/nearby-sqlite-driver';
import { bridge, NativeExposure, type ExposureEvent, type ExposureOffer } from './src/bridge';

const ORIGIN = 'https://portofolio.pegasoft.ai';
const DATABASE = 'portofolio-nearby-synthetic-v1.db';
const BUILD_PROFILE = bridge.buildProfile();
type Event = { time: string; message: string };
type Runtime = {
  db: SQLite.SQLiteDatabase; wallet: SyntheticSQLiteNearbyWallet; session: NearbyConsentSession;
  offers: SyntheticNearbyOffers; failNextSave: boolean;
};
let bootPromise: Promise<Runtime> | undefined;
function boot(): Promise<Runtime> {
  return bootPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE, { useNewConnection: true });
    const wallet = new SyntheticSQLiteNearbyWallet(syntheticNearbySQLiteDriver(db));
    // A crash during the diagnostic fault must not leave all later saves forced to fail.
    await db.execAsync('DROP TRIGGER IF EXISTS lab_fail_save');
    await wallet.initialize();
    const offers = new SyntheticNearbyOffers({ trustedOrigin: ORIGIN, now: Date.now, token: bridge.randomToken });
    demoCards.slice(0, 2).forEach(card => offers.publish(card));
    const runtime = { db, wallet, offers, failNextSave: false } as Runtime;
    const store: NearbyWalletStore = {
      read: () => wallet.read(),
      commit: async update => {
        const fail = runtime.failNextSave; runtime.failNextSave = false;
        if (fail) await db.execAsync("CREATE TRIGGER lab_fail_save BEFORE UPDATE ON nearby_synthetic_wallet BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
        try { await wallet.commit(update); }
        finally { if (fail) await db.execAsync('DROP TRIGGER IF EXISTS lab_fail_save'); }
      },
    };
    runtime.session = new NearbyConsentSession({ trustedOrigin: ORIGIN, resolve: offers.resolve, wallet: store, now: Date.now });
    return runtime;
  })();
}

export default function App() {
  const runtime = useRef<Runtime | null>(null);
  const events = useRef<Event[]>([]);
  const issued = useRef<ExposureOffer | null>(null);
  const sequence = useRef(0);
  const [offer, setOffer] = useState<ExposureOffer | null>(null);
  const [nativeArmedId, setNativeArmedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NearbyWalletSnapshot>({ cards: [], decisions: {} });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState('Starting isolated SQLite wallet…');
  const [evidenceError, setEvidenceError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fail, setFail] = useState(false);

  const record = useCallback((message: string) => {
    events.current = [...events.current, { time: new Date().toISOString(), message }].slice(-200);
    setRevision(value => value + 1);
  }, []);
  const persistEvidence = useCallback(async () => {
    const current = runtime.current;
    if (!current) return;
    const value = await current.wallet.read();
    setSnapshot(value);
    try {
      bridge.writeEvidence(JSON.stringify({ app: 'Nearby Lab 0.1', buildProfile: BUILD_PROFILE, os: Platform.Version,
        database: DATABASE, resolver: 'in-memory synthetic; no HTTPS service configured',
        snapshot: value, events: events.current }));
      setEvidenceError(false);
    } catch { setEvidenceError(true); }
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) {
      const code = error instanceof NearbyError ? error.code : 'local_error';
      record(`ACTION_FAILED ${code}`); setStatus(`Action failed: ${code}`);
    } finally {
      try { await persistEvidence(); } catch { setEvidenceError(true); }
      setFail(runtime.current?.failNextSave ?? false);
      setBusy(false); setRevision(value => value + 1);
    }
  }, [record, persistEvidence]);
  const receive = useCallback(async (url: string, source: string) => {
    const current = runtime.current;
    if (!current) return;
    const result = await current.session.receive(url);
    record(`RECEIPT source=${source} result=${result}`);
    setStatus(result === 'preview' ? 'Consent required. Nothing saved yet.' : result);
  }, [record]);

  useEffect(() => {
    let mounted = true;
    boot().then(async value => {
      if (!mounted) return;
      runtime.current = value; setReady(true);
      record(`LAUNCH profile=${BUILD_PROFILE} synthetic_only=true provider=Expo_hosted_SwiftUI resolver=in_memory`);
      setStatus('Ready. Native HTTPS receipt is unconfigured; injection tests local coordination only.');
      await persistEvidence();
      const initial = await Linking.getInitialURL();
      if (initial && parseNearbyOfferLink(initial, ORIGIN)) await run(() => receive(initial, 'initial_os_url'));
    }).catch(() => { if (mounted) setStatus('Storage initialization failed. Existing evidence is preserved.'); });
    const subscription = Linking.addEventListener('url', ({ url }) => { void run(() => receive(url, 'os_url')); });
    const lifecycle = AppState.addEventListener('change', state => {
      record(`SCENE ${state}`);
      if (state === 'background') setOffer(null);
      void persistEvidence().catch(() => setEvidenceError(true));
    });
    return () => { mounted = false; subscription.remove(); lifecycle.remove(); runtime.current?.session.dismiss(); };
  }, [persistEvidence, receive, record, run]);

  const onNativeState = (event: ExposureEvent) => {
    record(`NATIVE ${event.state} id=${event.id ?? 'none'} reason=${event.reason ?? 'none'}`);
    if (event.state === 'armed' && event.id) setNativeArmedId(event.id);
    if (event.state === 'disarmed') {
      setOffer(current => current?.id === event.id ? null : current);
      setNativeArmedId(current => current === event.id ? null : current);
    }
    if (event.state === 'invalid') {
      setOffer(current => current?.id === event.id ? null : current);
      setStatus(`Native offer rejected: ${event.reason}`);
    }
    void persistEvidence().catch(() => setEvidenceError(true));
  };
  const current = runtime.current;
  const preview = current?.session.preview;
  const action = (fn: () => Promise<void>) => () => { void run(fn); };

  return <View style={styles.root}>
    <NativeExposure style={styles.exposure} offer={offer} onState={event => onNativeState(event.nativeEvent)} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Portofolio Nearby Lab</Text>
      <Text style={styles.body}>Separate test app · synthetic cards only · iOS bridge + isolated SQLite</Text>
      <Text style={styles.body}>{BUILD_PROFILE === 'limited-personal-team'
        ? 'LIMITED DEVICE BUILD · No Associated Domains. HTTPS links cannot open this lab through Universal Links. Use labelled local injection for consent/storage checks.'
        : `Build profile: ${BUILD_PROFILE} · HTTPS routing still requires server/domain setup and device verification.`}</Text>
      <Text style={styles.body}>Resolver: in-memory. Local receipt injection is not HTTPS/AirDrop routing proof.</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{status}</Text>
      {evidenceError && <Text style={styles.error}>Evidence export failed. The current run is not fully recorded.</Text>}

      <Text accessibilityRole="header" style={styles.heading}>Sender</Text>
      {demoCards.slice(0, 2).map((card, index) => <Button key={card.id} disabled={busy || !ready} title={`${selected === index ? '✓ ' : ''}${card.displayName}`} onPress={() => { setSelected(index); setOffer(null); }} />)}
      <Button disabled={busy || !ready} title="Issue and arm selected synthetic card" onPress={action(async () => {
        const card = demoCards[selected], url = current!.offers.issue(card.id);
        const token = parseNearbyOfferLink(url, ORIGIN)!;
        const resolution = await current!.offers.resolve(token) as { offer: { expiresAt: number } };
        const next = { id: `lab-${Date.now()}-${++sequence.current}`, url, expiresAt: resolution.offer.expiresAt };
        issued.current = next; setOffer(next); record(`ARM_REQUEST id=${next.id} card=${card.id}`);
        setStatus('Await native armed event. Only synthetic HTTPS link is exposed.');
      })} />
      <Text style={styles.body}>{offer ? offer.id === nativeArmedId ? 'Armed — native provider acknowledged; proximity unverified' : 'Waiting for native arm acknowledgement' : 'Unarmed'}</Text>
      <Button title="Stop sharing" disabled={!offer} onPress={() => setOffer(null)} />
      <Button disabled={busy || !ready} title="Test native rejection of an untrusted URL" onPress={() => setOffer({ id: `invalid-${++sequence.current}`, url: 'https://untrusted.invalid/nearby/' + 'a'.repeat(64), expiresAt: Date.now() + 300000 })} />

      <Text accessibilityRole="header" style={styles.heading}>Receiver / synthetic injection</Text>
      <Button disabled={busy || !issued.current || !ready} title="Inject issued HTTPS URL locally" onPress={action(() => receive(issued.current!.url, 'local_injection'))} />
      <View style={styles.row}><Text style={styles.body}>Simulate resolver offline</Text><Switch accessibilityLabel="Simulate resolver offline" value={offline} disabled={busy || !ready} onValueChange={value => { setOffline(value); if (current) current.offers.online = !value; }} /></View>
      <View style={styles.row}><Text style={styles.body}>Fail next decision write</Text><Switch accessibilityLabel="Fail next decision write" value={fail} disabled={busy || !ready} onValueChange={value => { setFail(value); if (current) current.failNextSave = value; }} /></View>
      {preview && <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.heading}>Receive test card</Text>
        <Text style={styles.body}>{preview.card.displayName}</Text>
        <Text style={styles.body}>{preview.card.category} · {preview.card.area}</Text>
        <Button disabled={busy} title="Accept synthetic card" onPress={action(async () => {
          await current!.session.accept(preview.offer.token);
          record(`RECIPIENT_SAVED card=${preview.card.id}`); setFail(false); setStatus('Saved synthetic card after atomic SQLite commit.');
        })} />
        <Button disabled={busy} title="Decline" onPress={action(async () => {
          await current!.session.decline(preview.offer.token);
          record(`RECIPIENT_DECLINED card=${preview.card.id}`); setFail(false); setStatus('Declined. Nothing added.');
        })} />
      </View>}
      <Button disabled={busy || !current?.session.pendingToken} title="Dismiss pending consent" onPress={() => { current?.session.dismiss(); record('CONSENT_DISMISSED'); setRevision(value => value + 1); }} />
      <Text accessibilityRole="header" style={styles.heading}>Saved in this lab</Text>
      {snapshot.cards.length === 0 && <Text style={styles.body}>No saved synthetic cards.</Text>}
      {snapshot.cards.map(entry => <Text key={entry.card.id} style={styles.body}>Saved: {entry.card.displayName} · favorite={String(entry.favorite)} · order={entry.order} · note={entry.note || '(empty)'}</Text>)}
      <Button disabled={busy || snapshot.cards.length === 0} title="Set diagnostic metadata on first saved card" onPress={action(async () => {
        await current!.wallet.commit(value => ({ ...value, cards: value.cards.map((entry, index) => index === 0 ? { ...entry,
          note: 'Keep this note / Διατήρησε τη σημείωση', favorite: true, order: 7,
          lastOpenedAt: new Date().toISOString() } : entry) }));
        record('METADATA_UPDATED first_saved_card');
      })} />
      <Button disabled={busy || !ready} title="Refresh snapshot / export evidence" onPress={action(async () => { record('SNAPSHOT_REQUEST'); })} />
      <Text style={styles.body}>Evidence: Documents/nearby-lab-evidence.json · render {revision}</Text>
      {events.current.slice(-10).reverse().map((event, index) => <Text key={`${event.time}-${index}`} style={styles.log}>{event.message}</Text>)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PlatformColor('systemBackground') },
  content: { padding: 24, paddingTop: 70, paddingBottom: 60, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: PlatformColor('label') },
  heading: { fontSize: 20, fontWeight: '600', color: PlatformColor('label'), marginTop: 12 },
  body: { fontSize: 16, color: PlatformColor('label') },
  error: { fontSize: 16, color: PlatformColor('systemRed') },
  panel: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: PlatformColor('secondarySystemBackground') },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  log: { fontSize: 12, fontFamily: 'Menlo', color: PlatformColor('secondaryLabel') },
  exposure: { position: 'absolute', width: 1, height: 1, left: 0, top: 0 },
});
