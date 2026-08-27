'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';
import { AttachmentsPanel } from '../../../../components/shared/AttachmentsPanel';

interface EntryLine {
  id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: string;
  label: string | null;
  account: { code: string; label: string };
}

interface EntryDetail {
  id: string;
  entryNumber: string;
  entryDate: string;
  label: string;
  reference: string | null;
  status: 'DRAFT' | 'VALIDATED' | 'REVERSED';
  totalDebit: string;
  totalCredit: string;
  journal: { code: string; label: string };
  period: { name: string };
  createdBy: { firstName: string; lastName: string };
  validatedBy: { firstName: string; lastName: string } | null;
  validatedAt: string | null;
  lines: EntryLine[];
  attachments: Array<{ id: string; fileName: string }>;
  reversalOfEntry: { id: string; entryNumber: string } | null;
  reversedByEntry: { id: string; entryNumber: string } | null;
}

export default function AccountingEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReverseForm, setShowReverseForm] = useState(false);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<EntryDetail>(`/companies/${currentCompanyId}/accounting-entries/${params.id}`);
      setEntry(data);
    } catch (err) {
      if (err instanceof AxiosError && (err.response?.status === 403 || err.response?.status === 404)) {
        setError('Écriture introuvable ou accès refusé.');
      } else {
        setError('Impossible de charger cette écriture.');
      }
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, params.id]);

  async function handleDelete() {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    await apiClient.delete(`/companies/${currentCompanyId}/accounting-entries/${params.id}`);
    router.push('/accounting/entries');
  }

  async function handleValidate() {
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/accounting-entries/${params.id}/validate`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleReverse() {
    setIsProcessing(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/accounting-entries/${params.id}/reverse`, { reversalDate });
      router.push(`/accounting/entries/${data.id}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !entry) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <h1>Erreur</h1>
        <p role="alert">{error}</p>
        <a href="/accounting/entries">Retour à la liste</a>
      </main>
    );
  }

  if (!entry) {
    return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;
  }

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        Écriture {entry.entryNumber} — {entry.status}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <table>
        <tbody>
          <tr>
            <td>Date</td>
            <td>{entry.entryDate.slice(0, 10)}</td>
          </tr>
          <tr>
            <td>Journal</td>
            <td>
              {entry.journal.code} — {entry.journal.label}
            </td>
          </tr>
          <tr>
            <td>Référence</td>
            <td>{entry.reference ?? '—'}</td>
          </tr>
          <tr>
            <td>Libellé</td>
            <td>{entry.label}</td>
          </tr>
          <tr>
            <td>Exercice</td>
            <td>{entry.period.name}</td>
          </tr>
          <tr>
            <td>Créée par</td>
            <td>
              {entry.createdBy.firstName} {entry.createdBy.lastName}
            </td>
          </tr>
          {entry.validatedBy && (
            <tr>
              <td>Validée par</td>
              <td>
                {entry.validatedBy.firstName} {entry.validatedBy.lastName} le {entry.validatedAt?.slice(0, 10)}
              </td>
            </tr>
          )}
          {entry.reversalOfEntry && (
            <tr>
              <td>Contrepasse</td>
              <td>
                <a href={`/accounting/entries/${entry.reversalOfEntry.id}`}>{entry.reversalOfEntry.entryNumber}</a>
              </td>
            </tr>
          )}
          {entry.reversedByEntry && (
            <tr>
              <td>Contrepassée par</td>
              <td>
                <a href={`/accounting/entries/${entry.reversedByEntry.id}`}>{entry.reversedByEntry.entryNumber}</a>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Lignes</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Compte</th>
            <th align="left">Libellé</th>
            <th align="right">Débit</th>
            <th align="right">Crédit</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.account.code} — {l.account.label}
              </td>
              <td>{l.label ?? ''}</td>
              <td align="right">{l.side === 'DEBIT' ? Number(l.amount).toLocaleString('fr-FR') : ''}</td>
              <td align="right">{l.side === 'CREDIT' ? Number(l.amount).toLocaleString('fr-FR') : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} align="right">
              <strong>TOTAUX</strong>
            </td>
            <td align="right">
              <strong>{Number(entry.totalDebit).toLocaleString('fr-FR')}</strong>
            </td>
            <td align="right">
              <strong>{Number(entry.totalCredit).toLocaleString('fr-FR')}</strong>
            </td>
          </tr>
        </tfoot>
      </table>

      {entry.attachments.length > 0 && (
        <>
          <h2>Pièces justificatives</h2>
          <ul>
            {entry.attachments.map((a) => (
              <li key={a.id}>{a.fileName}</li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        {entry.status === 'DRAFT' && (
          <>
            <a href={`/accounting/entries/${entry.id}/edit`}>
              <button type="button">Modifier</button>
            </a>{' '}
            <button type="button" onClick={handleDelete}>
              Supprimer
            </button>{' '}
            <button type="button" onClick={handleValidate} disabled={isProcessing}>
              Valider
            </button>
          </>
        )}
        {entry.status === 'VALIDATED' && !showReverseForm && (
          <button type="button" onClick={() => setShowReverseForm(true)}>
            Contrepasser
          </button>
        )}
        {entry.status === 'VALIDATED' && showReverseForm && (
          <div style={{ border: '1px solid #ccc', padding: '1rem' }}>
            <label htmlFor="reversalDate">Date de contrepassation</label>
            <br />
            <input id="reversalDate" type="date" value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} />
            <div>
              <button type="button" onClick={handleReverse} disabled={isProcessing}>
                Confirmer la contrepassation
              </button>{' '}
              <button type="button" onClick={() => setShowReverseForm(false)}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {entry.status === 'REVERSED' && entry.reversedByEntry && (
          <a href={`/accounting/entries/${entry.reversedByEntry.id}`}>
            <button type="button">Voir la contrepassation</button>
          </a>
        )}
      </div>

      <AttachmentsPanel companyId={currentCompanyId!} entityType="accountingEntry" entityId={entry.id} />

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/entries">Retour à la liste des écritures</a>
      </p>
    </main>
  );
}
