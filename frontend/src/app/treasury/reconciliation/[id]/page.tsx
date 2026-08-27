'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface ReconciliationDetail {
  id: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  statementBalance: string;
  bookBalance: string;
  status: string;
  matches: Array<{ id: string; statementTransaction: Line; bookTransaction: Line }>;
}

interface Line {
  id: string;
  type: string;
  amount: string;
  transactionDate: string;
  label: string;
  reference: string | null;
}

interface Suggestion {
  statementTransactionId: string;
  bookTransactionId: string;
  confidence: 'forte' | 'moyenne';
  reason: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReconciliationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [rec, setRec] = useState<ReconciliationDetail | null>(null);
  const [statementLines, setStatementLines] = useState<Line[]>([]);
  const [bookLines, setBookLines] = useState<Line[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<ReconciliationDetail>(`/companies/${currentCompanyId}/reconciliations/${params.id}`);
      setRec(data);
      const [{ data: stmt }, { data: book }] = await Promise.all([
        apiClient.get(`/companies/${currentCompanyId}/bank-accounts/${data.bankAccountId}/unmatched-statement-lines`),
        apiClient.get(`/companies/${currentCompanyId}/bank-accounts/${data.bankAccountId}/unmatched-book-movements`),
      ]);
      setStatementLines(stmt);
      setBookLines(book);
    } catch {
      setError('Rapprochement introuvable.');
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

  async function handleMatch() {
    if (!selectedStatement || !selectedBook) return;
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/reconciliations/${params.id}/matches`, {
        statementTransactionId: selectedStatement,
        bookTransactionId: selectedBook,
      });
      setSelectedStatement(null);
      setSelectedBook(null);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleUnmatch(matchId: string) {
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.delete(`/companies/${currentCompanyId}/reconciliations/${params.id}/matches/${matchId}`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function loadSuggestions() {
    if (!rec) return;
    try {
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/bank-accounts/${rec.bankAccountId}/reconciliation-suggestions`);
      setSuggestions(data.suggestions);
    } catch {
      setError('Impossible de calculer les suggestions.');
    }
  }

  async function applySuggestion(s: Suggestion) {
    setIsProcessing(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/reconciliations/${params.id}/matches`, {
        statementTransactionId: s.statementTransactionId,
        bookTransactionId: s.bookTransactionId,
      });
      setSuggestions((prev) => (prev ?? []).filter((x) => x !== s));
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleComplete() {
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/reconciliations/${params.id}/complete`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Annuler ce rapprochement ? Toutes les lignes seront dé-pointées.')) return;
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/reconciliations/${params.id}/cancel`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !rec) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/treasury/reconciliation">Retour</a>
      </main>
    );
  }
  if (!rec) return <main style={{ maxWidth: 900, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>
        Rapprochement {rec.periodStart.slice(0, 10)} → {rec.periodEnd.slice(0, 10)} — {rec.status === 'IN_PROGRESS' ? 'En cours' : rec.status === 'COMPLETED' ? 'Clôturé' : 'Annulé'}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        Solde relevé : {fmt(Number(rec.statementBalance))} — Solde livre : {fmt(Number(rec.bookBalance))}
        {Math.round((Number(rec.statementBalance) - Number(rec.bookBalance)) * 100) === 0 ? (
          <span style={{ color: 'green' }}> ✓ Équilibré</span>
        ) : (
          <span style={{ color: 'red' }}> ⚠ Écart : {fmt(Number(rec.statementBalance) - Number(rec.bookBalance))}</span>
        )}
      </p>

      {rec.status === 'IN_PROGRESS' && (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" onClick={handleComplete} disabled={isProcessing}>
            Clôturer le rapprochement
          </button>{' '}
          <button type="button" onClick={loadSuggestions}>
            Suggestions automatiques
          </button>
        </div>
      )}
      {rec.status !== 'CANCELED' && (
        <button type="button" onClick={handleCancel} disabled={isProcessing}>
          Annuler ce rapprochement
        </button>
      )}

      {suggestions && (
        <div style={{ border: '1px solid #ccc', padding: '0.75rem', marginBottom: '1rem' }}>
          <h3>Suggestions ({suggestions.length})</h3>
          {suggestions.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune suggestion.</p>
          ) : (
            suggestions.map((s, i) => (
              <div key={i} style={{ borderTop: '1px solid #eee', padding: '0.5rem 0' }}>
                <p>
                  {s.confidence === 'forte' ? 'Forte' : 'Moyenne'} — {s.reason}
                </p>
                <button type="button" onClick={() => applySuggestion(s)} disabled={isProcessing}>
                  Appliquer
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {rec.status === 'IN_PROGRESS' && (
        <>
          <h2>Pointage manuel</h2>
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h3>Lignes de relevé non pointées</h3>
              {statementLines.map((l) => (
                <div key={l.id} style={{ background: selectedStatement === l.id ? '#f0f8ff' : undefined, cursor: 'pointer', padding: '0.25rem' }} onClick={() => setSelectedStatement(l.id)}>
                  {l.transactionDate.slice(0, 10)} — {l.label} — {l.type} {fmt(Number(l.amount))}
                </div>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <h3>Mouvements du livre non pointés</h3>
              {bookLines.map((l) => (
                <div key={l.id} style={{ background: selectedBook === l.id ? '#f0f8ff' : undefined, cursor: 'pointer', padding: '0.25rem' }} onClick={() => setSelectedBook(l.id)}>
                  {l.transactionDate.slice(0, 10)} — {l.label} — {l.type} {fmt(Number(l.amount))}
                </div>
              ))}
            </div>
          </div>
          <button type="button" onClick={handleMatch} disabled={!selectedStatement || !selectedBook || isProcessing} style={{ marginTop: '1rem' }}>
            Pointer la sélection
          </button>
        </>
      )}

      <h2>Lignes pointées</h2>
      {rec.matches.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun pointage.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Relevé</th>
              <th align="left">Livre</th>
              <th align="right">Montant</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rec.matches.map((m) => (
              <tr key={m.id}>
                <td>{m.statementTransaction.label}</td>
                <td>{m.bookTransaction.label}</td>
                <td align="right">{fmt(Number(m.statementTransaction.amount))}</td>
                <td>
                  {rec.status === 'IN_PROGRESS' && (
                    <button type="button" onClick={() => handleUnmatch(m.id)} disabled={isProcessing}>
                      Dé-pointer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/treasury/reconciliation">Retour aux rapprochements</a>
      </p>
    </main>
  );
}
