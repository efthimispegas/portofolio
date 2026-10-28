'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LogOut, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { categoryLabels, routeLabels, routeGuidance, routes, requiresSpecialistReview, type ProviderApplication, type SessionUser, type ApplicationStatus } from '@mastoli/core';
import { useApp } from './AppProvider';
import { Status } from './ProviderWorkspace';
import { ReviewHistory } from './ReviewHistory';
import { api, body, errorMessage, ApiFailure } from '../lib/client/api';
import styles from './review.module.css';

type Decision = 'approve' | 'request_information' | 'reject';
type CheckKey = 'identity' | 'workBasis' | 'credentials' | 'representation';
const emptyChecks: Record<CheckKey, boolean> = { identity: false, workBasis: false, credentials: false, representation: false };
const statuses: Exclude<ApplicationStatus, 'draft'>[] = ['submitted', 'needs_information', 'approved', 'rejected'];

export function ReviewWorkspace() {
  const { t, locale } = useApp();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProviderApplication[]>([]);
  const [selected, setSelected] = useState<ProviderApplication | null>(null);
  const [status, setStatus] = useState<Exclude<ApplicationStatus, 'draft'> | 'all'>('submitted');
  const [route, setRoute] = useState('all');
  const [query, setQuery] = useState('');
  const [checks, setChecks] = useState({ ...emptyChecks });
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const localeCode = locale === 'el' ? 'el-GR' : 'en-GB';
  const date = (value: string) => new Date(value).toLocaleString(localeCode);
  const labels = { submitted: t('Προς έλεγχο', 'To review'), needs_information: t('Αναμονή στοιχείων', 'Awaiting applicant'), approved: t('Δημοσιευμένες', 'Published'), rejected: t('Δεν εγκρίθηκαν', 'Not approved'), all: t('Όλες', 'All') };
  const decisions = { approve: t('Έγκριση και δημοσίευση', 'Approve and publish'), request_information: t('Αίτημα στοιχείων', 'Request information'), reject: t('Μη έγκριση', 'Do not approve') };
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  const visible = items.filter(item => (status === 'all' || item.status === status) && (route === 'all' || item.route === route) && normalize(`${item.displayName} ${item.area} ${item.id}`).includes(normalize(query))).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));

  async function load() {
    const session = await api<{ user: SessionUser | null }>('/api/auth/session');
    setUser(session.user);
    if (session.user?.role === 'reviewer') {
      const applications = await api<ProviderApplication[]>('/api/review/applications');
      setItems(applications);
      return applications;
    }
    setItems([]);
    return [];
  }
  useEffect(() => { load().catch(() => setError(t('Ο διακομιστής δεν είναι διαθέσιμος. Δοκίμασε ανανέωση.', 'The server is unavailable. Try refreshing.'))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (confirm) confirmation.current?.focus(); }, [confirm]);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected?.id]);
  function open(item: ProviderApplication) {
    setSelected(item); setScope(item.serviceScope); setReason(''); setChecks({ ...emptyChecks }); setConfirm(null); setError(''); setMessage(''); setStale(false);
  }
  async function refresh() {
    setBusy(true); setError('');
    try {
      const applications = await load();
      if (selected) {
        const latest = applications.find(item => item.id === selected.id);
        if (latest && latest.updatedAt !== selected.updatedAt) open(latest); else if (!latest) setSelected(null);
      }
      setMessage(t('Οι αιτήσεις ενημερώθηκαν από τον διακομιστή.', 'Applications refreshed from the server.'));
    } catch (error) { setError(errorMessage(error, locale)); } finally { setBusy(false); }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try { await api('/api/auth/dev-reviewer', { method: 'POST', headers: { 'X-Dev-Reviewer-Key': String(data.get('key')) }, body: body({}) }); await load(); }
    catch { setError(t('Η πρόσβαση δεν επιτράπηκε. Χρειάζονται ενεργή τοπική λειτουργία ελέγχου και έγκυρο κλειδί.', 'Access denied. Enabled local reviewer mode and a valid key are required.')); }
    finally { setBusy(false); }
  }
  async function decide() {
    if (!selected || !confirm) return;
    setBusy(true); setError('');
    try {
      const result = await api<ProviderApplication>(`/api/review/applications/${selected.id}`, { method: 'POST', body: body({ decision: confirm, reason, checks, serviceScope: scope, expectedUpdatedAt: selected.updatedAt }) });
      setSelected(result); setConfirm(null); setStale(false);
      setItems(current => current.map(item => item.id === result.id ? result : item));
      setMessage(t('Η απόφαση καταγράφηκε. Ο επαγγελματίας τη βλέπει στην αίτησή του.', 'Decision recorded. The applicant can see it in their application.'));
    } catch (error) { setError(errorMessage(error, locale)); if (error instanceof ApiFailure && ['STALE_REVIEW', 'APPLICATION_LOCKED'].includes(error.code)) { setStale(true); setConfirm(null); } }
    finally { setBusy(false); }
  }
  const approvalReady = selected && !requiresSpecialistReview(selected.route) && Object.values(checks).every(Boolean) && scope.trim().length >= 5 && reason.trim().length >= 10 && !stale;
  const editable = selected?.status === 'submitted';

  function checkCopy(key: CheckKey) {
    if (!selected) return ['', ''];
    const titles: Record<CheckKey, string> = { identity: t('Ταυτότητα και στοιχεία αιτούντος', 'Identity and applicant details'), workBasis: t('Βάση δραστηριότητας / εργασίας', 'Basis for activity or work'), credentials: t('Επαγγελματική ιδιότητα', 'Professional credentials'), representation: t('Εκπροσώπηση', 'Representation') };
    const hints: Record<CheckKey, string> = {
      identity: t('Επιβεβαίωσε ότι ο αιτών αντιστοιχεί στα στοιχεία της κάρτας.', 'Confirm that the applicant matches the identity on the card.'),
      workBasis: selected.route === 'employee' ? t('Έλεγξε τη σχέση με την αναφερόμενη επιχείρηση και το πεδίο εργασίας.', 'Check the relationship with the named organization and the work scope.') : selected.route === 'business' || selected.route === 'independent' ? t('Έλεγξε την τρέχουσα δραστηριότητα ΑΑΔΕ και το ΓΕΜΗ όπου εφαρμόζεται. Η μορφή αριθμού δεν αποτελεί επαλήθευση.', 'Check current AADE activity and GEMI where applicable. A valid number format is not verification.') : t('Απαιτείται επικυρωμένος ειδικός έλεγχος για αυτή τη διαδρομή.', 'This route requires a validated specialist checklist.'),
      credentials: t('Έλεγξε τα προσόντα για τις ακριβείς υπηρεσίες ή τεκμηρίωσε γιατί δεν απαιτούνται.', 'Check credentials for the exact services, or document why they do not apply.'),
      representation: selected.route === 'employee' || selected.route === 'business' ? t('Έλεγξε την εξουσιοδότηση για την επιχείρηση που εμφανίζεται στην κάρτα.', 'Check authorization to represent the organization shown on the card.') : t('Επιβεβαίωσε ότι ενεργεί για τον εαυτό του ή ότι έχει σχετική εξουσιοδότηση.', 'Confirm the applicant acts for themselves or holds the relevant authorization.')
    };
    return [titles[key], hints[key]];
  }

  return <main id="main" className={`page-shell ${styles.workspace}`}>
    <div className="page-heading"><div><h1>{t('Έλεγχος επαγγελματιών', 'Professional review')}</h1><p>{t('Μια σαφής απόφαση πριν η κάρτα γίνει δημόσια.', 'A clear decision before a card becomes public.')}</p></div><ShieldCheck size={30} strokeWidth={1.4} /></div>
    <p className={styles.localBoundary}>{t('Τοπική δοκιμή · Δεν γίνονται ζωντανοί έλεγχοι μητρώων ή αποστολή ειδοποιήσεων.', 'Local preview · No live registry checks or notification delivery.')}</p>
    {error && <div className="alert error" role="alert">{error}{stale && <button className="text-link" disabled={busy} onClick={refresh}>{t('Επαναφόρτωση αίτησης', 'Reload application')}</button>}</div>}
    {message && <div className="alert success" role="status"><Check size={18}/>{message}</div>}
    {loading ? <div className={styles.skeleton} role="status" aria-label={t('Φόρτωση αιτήσεων', 'Loading applications')}><div/><div/><div/></div> : user?.role !== 'reviewer' ? <section className="auth-panel reviewer-login">
      <h2>{t('Πρόσβαση ελεγκτή', 'Reviewer access')}</h2><p>{t('Χρησιμοποίησε το κλειδί του τοπικού διαχειριστή. Η πρόσβαση αυτή δεν διατίθεται σε παραγωγή.', 'Use the local operator key. This access method is unavailable in production.')}</p>
      {user && <div className="notice">{t('Ο λογαριασμός σου δεν έχει δικαιώματα ελεγκτή.', 'Your account does not have reviewer privileges.')}</div>}
      <form onSubmit={login}><label className="field"><span>{t('Κλειδί τοπικού ελεγκτή', 'Local reviewer key')}</span><input name="key" type="password" autoComplete="off" minLength={32} required/></label><button className="button primary wide" disabled={busy}>{busy ? t('Σύνδεση…', 'Signing in…') : t('Είσοδος ελεγκτή', 'Enter reviewer console')}</button></form>
    </section> : <>
      <div className={styles.toolbar}><span>{user.name}</span><div><button className="text-link" onClick={refresh} disabled={busy}><RefreshCw size={16}/>{t('Ανανέωση', 'Refresh')}</button><button className="text-link" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); setItems([]); setSelected(null); setMessage(''); } catch (error) { setError(errorMessage(error, locale)); } finally { setBusy(false); } }}><LogOut size={16}/>{t('Αποσύνδεση', 'Sign out')}</button></div></div>
      {selected ? <>
        <button className="back-link" disabled={busy} onClick={() => { setSelected(null); setConfirm(null); setError(''); }}><ArrowLeft size={16}/>{t('Πίσω στην ουρά', 'Back to queue')}</button>
        <div className={styles.detailHeading}><div><Status status={selected.status}/><h2 ref={detailHeading} tabIndex={-1}>{selected.displayName}</h2><p>{categoryLabels[selected.category][locale]} · {selected.area}</p></div><time dateTime={selected.updatedAt}>{t('Ενημερώθηκε', 'Updated')} {date(selected.updatedAt)}</time></div>
        <div className={styles.detailGrid}>
          <div>
            <section className={styles.section}><h3>{t('Τα στοιχεία που θα δει ο πελάτης', 'What the customer will see')}</h3><p>{selected.description}</p><dl className={styles.facts}>{[[t('Υπηρεσίες', 'Services'), selected.serviceScope], [t('Τηλέφωνο', 'Phone'), selected.phone], ['Email', selected.email], [t('Ιστότοπος', 'Website'), selected.website], ['Instagram', selected.instagramUrl], ['Facebook', selected.facebookUrl], ['LinkedIn', selected.linkedinUrl]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
            <section className={styles.section}><h3>{t('Ιδιωτικά στοιχεία ελέγχου', 'Private review information')}</h3><p className="route-guidance"><strong>{routeLabels[selected.route][locale]}</strong><br/>{routeGuidance[selected.route][locale]}</p><dl className={styles.facts}>{[['ΑΦΜ / AFM', selected.businessTaxId], ['ΓΕΜΗ / GEMI', selected.gemiNumber], [t('Υποχρέωση ΓΕΜΗ', 'GEMI applicability'), ({ required: t('Απαιτείται', 'Required'), not_required: t('Δεν απαιτείται — προς έλεγχο', 'Not required — to be reviewed'), unknown: t('Χρειάζεται διευκρίνιση', 'Needs clarification') })[selected.gemiApplicability]], [t('Επιχείρηση', 'Organization'), selected.employerName], [t('Εργασιακή διαδρομή', 'Work arrangement'), selected.justification], [t('Προσόντα / δραστηριότητα', 'Credentials / activity'), selected.professionCredential], [t('Διαθέσιμα στοιχεία', 'Available evidence'), selected.evidenceNotes]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="quiet">{t('Η ασφάλιση e-ΕΦΚΑ μόνη της δεν επαληθεύει δικαίωμα ανεξάρτητης παροχής υπηρεσιών.', 'e-EFKA coverage alone does not verify eligibility for independent services.')}</p></section>
            <ReviewHistory applicationId={selected.id} reviewer revision={selected.updatedAt}/>
          </div>
          <aside className={styles.decisionPanel} aria-label={t('Απόφαση ελέγχου', 'Review decision')}>
            {editable ? <>
              <h3>{t('Ολοκλήρωση ελέγχου', 'Complete review')}</h3>
              {requiresSpecialistReview(selected.route) && <div className={styles.blocker}><strong>{t('Αναμονή ειδικού ελέγχου', 'Specialist review required')}</strong><p>{t('Η έγκριση παραμένει κλειστή μέχρι να επικυρωθεί ο έλεγχος αυτής της διαδρομής. Ζήτησε τα συγκεκριμένα στοιχεία που λείπουν ή άφησε την αίτηση στην ουρά.', 'Approval stays unavailable until this route’s checklist is validated. Request specific missing information or leave the application in the queue.')}</p></div>}
              <fieldset className={styles.checklist} disabled={busy || !!confirm || stale}><legend>{t('Τεκμηριωμένοι έλεγχοι', 'Evidence checks')}</legend>{(Object.keys(checks) as CheckKey[]).map(key => { const [title, hint] = checkCopy(key); return <label className="checkbox-field" key={key}><input type="checkbox" checked={checks[key]} onChange={event => setChecks({ ...checks, [key]: event.target.checked })}/><span><strong>{title}</strong><small>{hint}</small></span></label>; })}</fieldset>
              <label className="field"><span>{t('Εγκεκριμένο πεδίο υπηρεσιών', 'Approved service scope')}</span><textarea rows={3} maxLength={600} value={scope} disabled={busy || !!confirm || stale} onChange={event => setScope(event.target.value)}/><small>{t('Αφορά την έγκριση. Περιόρισε την κάρτα στις υπηρεσίες που ελέγχθηκαν.', 'For approval. Limit the card to the services actually reviewed.')}</small></label>
              <label className="field"><span>{t('Μήνυμα προς τον επαγγελματία', 'Message to the applicant')}</span><textarea rows={4} maxLength={1200} value={reason} disabled={busy || !!confirm || stale} onChange={event => setReason(event.target.value)} placeholder={t('Τι επιβεβαιώθηκε ή τι ακριβώς χρειάζεται να διορθωθεί;', 'What was confirmed, or exactly what needs to be corrected?')}/><small>{t('Τουλάχιστον 10 χαρακτήρες. Εμφανίζεται στην αίτηση και στο ιστορικό της.', 'At least 10 characters. Visible in the application and its history.')}</small></label>
              {!confirm ? <>
                <p className={styles.requirements}>{Object.values(checks).filter(Boolean).length}/4 {t('έλεγχοι ολοκληρώθηκαν', 'checks completed')}{!requiresSpecialistReview(selected.route) && !approvalReady && <span>{t('Για έγκριση χρειάζονται όλοι οι έλεγχοι, πεδίο υπηρεσιών και μήνυμα.', 'Approval needs all checks, a service scope and a message.')}</span>}</p>
                <div className={styles.actions}><button className="button primary" disabled={busy || !approvalReady} onClick={() => setConfirm('approve')}>{decisions.approve}</button><button className="button secondary" disabled={busy || stale || reason.trim().length < 10} onClick={() => setConfirm('request_information')}>{decisions.request_information}</button><button className="text-link" disabled={busy || stale || reason.trim().length < 10} onClick={() => setConfirm('reject')}>{decisions.reject}</button></div>
              </> : <div className={styles.confirmation} ref={confirmation} tabIndex={-1}><h4>{t('Επιβεβαίωση απόφασης', 'Confirm decision')}</h4><strong>{decisions[confirm]}</strong><p>{confirm === 'approve' ? t('Η κάρτα θα γίνει δημόσια με το εγκεκριμένο πεδίο υπηρεσιών.', 'The card will become public with the approved service scope.') : confirm === 'request_information' ? t('Ο επαγγελματίας θα μπορεί να διορθώσει και να υποβάλει ξανά την αίτηση. Δεν δημοσιεύεται νέα κάρτα.', 'The applicant can edit and resubmit. No new card is published.') : t('Η αίτηση θα κλείσει χωρίς δημοσίευση νέας κάρτας.', 'The application will close without publishing a new card.')}</p>{confirm === 'approve' && <div className={styles.publicPreview}><strong>{t('Δημόσια στοιχεία κάρτας', 'Public card details')}</strong><p>{selected.displayName} · {categoryLabels[selected.category][locale]} · {selected.area}</p><p>{selected.description}</p><p>{scope}</p><p>{[selected.phone, selected.email, selected.website, selected.instagramUrl, selected.facebookUrl, selected.linkedinUrl].filter(Boolean).join(' · ')}</p><p className="quiet">{t('ΑΦΜ, ΓΕΜΗ και ιδιωτική τεκμηρίωση δεν δημοσιεύονται.', 'AFM, GEMI and private evidence are not published.')}</p></div>}<blockquote>{reason}</blockquote><div className={styles.actions}><button className={`button ${confirm === 'reject' ? 'danger' : 'primary'}`} disabled={busy} onClick={decide}>{busy ? t('Καταγραφή…', 'Recording…') : t('Καταγραφή απόφασης', 'Record decision')}</button><button className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>{t('Επιστροφή στον έλεγχο', 'Back to review')}</button></div></div>}
            </> : <><h3>{t('Επόμενο βήμα', 'Next step')}</h3><p>{selected.status === 'needs_information' ? t('Περιμένουμε τη διόρθωση και νέα υποβολή από τον επαγγελματία. Η απόφαση και το μήνυμα είναι διαθέσιμα στην αίτησή του.', 'Waiting for the applicant to update and resubmit. The decision and message are visible in their application.') : selected.status === 'approved' ? t('Η κάρτα δημοσιεύτηκε. Οι επόμενες αλλαγές υποβάλλονται ως νέα αναθεώρηση για έλεγχο.', 'The card is published. Further changes require a new reviewed revision.') : t('Η αίτηση έκλεισε χωρίς νέα δημοσίευση. Η αιτιολόγηση παραμένει στο ιστορικό.', 'The application closed without new publication. The reason remains in its history.')}</p>{selected.cardSlug && <Link className="button primary" href={`/c/${selected.cardSlug}`}>{t('Προβολή δημόσιας κάρτας', 'View public card')}<ArrowRight size={16}/></Link>}</>}
          </aside>
        </div>
      </> : <>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={18}/><input aria-label={t('Αναζήτηση αιτήσεων', 'Search applications')} placeholder={t('Όνομα, περιοχή ή αριθμός αίτησης', 'Name, area or application ID')} value={query} onChange={event => setQuery(event.target.value)}/></label>
          <label className="field"><span>{t('Εργασιακή διαδρομή', 'Work arrangement')}</span><select value={route} onChange={event => setRoute(event.target.value)}><option value="all">{t('Όλες οι διαδρομές', 'All work arrangements')}</option>{routes.map(value => <option value={value} key={value}>{routeLabels[value][locale]}</option>)}</select></label>
        </div>
        <div className={styles.statusFilters} aria-label={t('Κατάσταση αίτησης', 'Application status')}>{[...statuses, 'all' as const].map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{labels[value]} <span>{value === 'all' ? items.length : items.filter(item => item.status === value).length}</span></button>)}</div>
        <div className={styles.queueCaption}><p>{visible.length} {t('αιτήσεις', 'applications')}</p><p>{t('Παλαιότερη ενημέρωση πρώτα', 'Oldest update first')}</p></div>
        {visible.length ? <div className={styles.queue}>{visible.map(item => <article key={item.id}><div><Status status={item.status}/><h2>{item.displayName}</h2><p>{routeLabels[item.route][locale]} · {item.area}</p>{requiresSpecialistReview(item.route) && <span className={styles.specialist}>{t('Χρειάζεται ειδικό έλεγχο', 'Specialist review required')}</span>}<time dateTime={item.updatedAt}>{t('Ενημερώθηκε', 'Updated')} {date(item.updatedAt)}</time></div><button className="button secondary small" onClick={() => open(item)}>{item.status === 'submitted' ? t('Έλεγχος αίτησης', 'Review application') : t('Προβολή απόφασης', 'View decision')}<ArrowRight size={16}/></button></article>)}</div> : <div className={styles.empty}><ShieldCheck size={32} strokeWidth={1.4}/><h2>{items.length ? t('Καμία αίτηση με αυτά τα φίλτρα.', 'No applications match these filters.') : t('Η ουρά είναι έτοιμη.', 'The queue is ready.')}</h2><p>{items.length ? t('Δες άλλη κατάσταση ή καθάρισε τα φίλτρα.', 'Choose another status or clear the filters.') : t('Οι αιτήσεις θα εμφανίζονται εδώ μετά την υποβολή τους. Η υποβολή δεν δημοσιεύει την κάρτα.', 'Applications appear here after submission. Submitting does not publish a card.')}</p>{items.length > 0 && <button className="text-link" onClick={() => { setStatus('all'); setRoute('all'); setQuery(''); }}>{t('Εμφάνιση όλων', 'Show all applications')}</button>}</div>}
      </>}
    </>}
  </main>;
}
