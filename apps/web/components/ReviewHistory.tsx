'use client';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { api, errorMessage } from '../lib/client/api';
import styles from './review.module.css';
export interface ReviewEntry { decision: 'approve' | 'request_information' | 'reject'; reason: string; scope: string; checksJson: string; createdAt: string }
export function ReviewHistory({ applicationId, reviewer = false, revision = '' }: { applicationId: string; reviewer?: boolean; revision?: string }) {
  const { t, locale } = useApp();
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setEntries(null); setError('');
    api<ReviewEntry[]>(reviewer ? `/api/review/applications/${applicationId}` : `/api/applications/${applicationId}/history`)
      .then(value => { if (current) setEntries(value); })
      .catch(error => { if (current) setError(errorMessage(error, locale)); });
    return () => { current = false; };
  }, [applicationId, reviewer, revision, retry, locale]);
  const labels = { approve: t('Έγκριση και δημοσίευση', 'Approved and published'), request_information: t('Ζητήθηκαν στοιχεία', 'Information requested'), reject: t('Δεν εγκρίθηκε', 'Not approved') };
  return <section className={styles.history} aria-label={t('Ιστορικό αποφάσεων', 'Decision history')}>
    <h3>{t('Ιστορικό αποφάσεων', 'Decision history')}</h3>
    {error ? <div role="alert"><p className="error-text">{error}</p><button className="text-link" onClick={() => setRetry(value => value + 1)}>{t('Δοκίμασε ξανά', 'Try again')}</button></div>
      : entries === null ? <p role="status" className="quiet">{t('Φόρτωση ιστορικού…', 'Loading history…')}</p>
        : entries.length === 0 ? <p className="quiet">{t('Δεν έχει καταγραφεί απόφαση ακόμη.', 'No decision has been recorded yet.')}</p>
          : <ol>{entries.map((entry, index) => <li key={`${entry.createdAt}-${index}`}>
            <div className={styles.historyHeading}><strong>{labels[entry.decision]}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(locale === 'el' ? 'el-GR' : 'en-GB')}</time></div>
            <p>{entry.reason}</p>
            {entry.decision === 'approve' && <p className="quiet">{t('Εγκεκριμένες υπηρεσίες:', 'Approved services:')} {entry.scope}</p>}
          </li>)}</ol>}
  </section>;
}
