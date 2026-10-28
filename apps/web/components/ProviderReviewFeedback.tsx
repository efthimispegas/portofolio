'use client';
import { useState } from 'react';
import type { ProviderApplication } from '@mastoli/core';
import { useApp } from './AppProvider';
import { ReviewHistory } from './ReviewHistory';
import styles from './review.module.css';
export function ProviderReviewFeedback({ application }: { application: ProviderApplication }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  if (application.status === 'draft') return null;
  const next = application.status === 'submitted'
    ? t('Περιμένουμε τον έλεγχο. Η νέα κάρτα ή οι αλλαγές σου δεν δημοσιεύονται μέχρι την έγκριση.', 'Waiting for review. Your new card or changes stay unpublished until approval.')
    : application.status === 'needs_information'
      ? t('Διάβασε το σχόλιο, επίλεξε «Συνέχεια», διόρθωσε τα στοιχεία και υπέβαλε ξανά.', 'Read the note, choose “Continue”, update the requested details and submit again.')
      : application.status === 'approved'
        ? t('Η κάρτα σου είναι δημόσια. Για αλλαγές, επίλεξε «Αίτηση αλλαγών».', 'Your card is public. To edit it, choose “Request changes”.')
        : t('Η αίτηση έκλεισε χωρίς νέα δημοσίευση. Διάβασε την αιτιολόγηση πριν δημιουργήσεις νέα αίτηση.', 'This application closed without new publication. Read the reason before creating a new application.');
  return <div className={styles.providerFeedback}><p>{next}</p><button className="text-link" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? t('Απόκρυψη ιστορικού', 'Hide history') : t('Ιστορικό ελέγχου', 'Review history')}</button>{open && <ReviewHistory applicationId={application.id} revision={application.updatedAt}/>}</div>;
}
