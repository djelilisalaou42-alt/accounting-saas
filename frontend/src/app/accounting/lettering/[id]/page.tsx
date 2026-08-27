'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface LetteringDetail {
  id: string;
  code: string;
  account: { id: string; code: string; label: string };
  status: 'OPEN' | 'CLOSED' | 'CANCELED';
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
  canceledAt: string | null;
  canceledBy: { firstName: string; lastName: string } | null;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  lines: Array<{
    id: string;
    entryNumber: string;
    entryDate: string;
    entryLabel: string;
    journalCode: string;
    lineLabel: string | null;
    debit: number;
    credit: number;
  }>;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LetteringDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [lettering, setLettering] = useState<LetteringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnletterConfirm, setShowUnletterConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<LetteringDetail>(`/companies/${currentCompanyId}/lettering/${params.id}`);
      setLettering(data);
    } catch (err) {
      if (err instanceof AxiosError && (err.response?.status === 403 || err.response?.status === 404)) {
        setError('Lettrage introuvable ou accès refusé.');
      } else {
        setError('Impossible de charger ce lettrage.');
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

  async function handleUnletter() {
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/lettering/${params.id}/unletter`);
      setShowUnletterConfirm(false);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !lettering) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <h1>Erreur</h1>
        <p role="alert">{error}</p>
        <a href="/accounting/lettering">Retour</a>
      </main>
    );
  }

  if (!lettering) {
    return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;
  }

  const statusLabel = lettering.status === 'OPEN' ? 'En cours' : lettering.status === 'CLOSED' ? 'Clôturé' : 'Délettré';

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        Lettrage {lettering.code} — {statusLabel}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <table>
        <tbody>
          <tr>
            <td>Compte</td>
            <td>
              {lettering.account.code} — {lettering.account.label}
            </td>
          </tr>
          <tr>
            <td>Créé par</td>
            <td>
              {lettering.createdBy.firstName} {lettering.createdBy.lastName} le {lettering.createdAt.slice(0, 10)}
            </td>
          </tr>
          {lettering.canceledAt && (
            <tr>
              <td>Délettré par</td>
              <td>
                {lettering.canceledBy?.firstName} {lettering.canceledBy?.lastName} le {lettering.canceledAt.slice(0, 10)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Lignes</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Date</th>
            <th align="left">Journal</th>
            <th align="left">Pièce</th>
            <th align="left">Libellé</th>
            <th align="right">Débit</th>
            <th align="right">Crédit</th>
          </tr>
        </thead>
        <tbody>
          {lettering.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.entryDate.slice(0, 10)}</td>
              <td>{l.journalCode}</td>
              <td>{l.entryNumber}</td>
              <td>{l.lineLabel ?? l.entryLabel}</td>
              <td align="right">{l.debit > 0 ? fmt(l.debit) : ''}</td>
              <td align="right">{l.credit > 0 ? fmt(l.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} align="right">
              <strong>TOTAUX</strong>
            </td>
            <td align="right">
              <strong>{fmt(lettering.totalDebit)}</strong>
            </td>
            <td align="right">
              <strong>{fmt(lettering.totalCredit)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
      <p>Différence : {fmt(lettering.difference)}</p>

      {lettering.status === 'CLOSED' && !showUnletterConfirm && (
        <button type="button" onClick={() => setShowUnletterConfirm(true)}>
          Délettrer
        </button>
      )}
      {showUnletterConfirm && (
        <div style={{ border: '1px solid #ccc', padding: '0.75rem' }}>
          <p>Voulez-vous vraiment défaire le lettrage {lettering.code} ?</p>
          <button type="button" onClick={handleUnletter} disabled={isProcessing}>
            Confirmer
          </button>{' '}
          <button type="button" onClick={() => setShowUnletterConfirm(false)}>
            Annuler
          </button>
        </div>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/lettering">Retour à la liste des lettrages</a>
      </p>
    </main>
  );
}
