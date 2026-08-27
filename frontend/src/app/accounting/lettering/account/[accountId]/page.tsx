'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

interface UnletteredLine {
  id: string;
  entryDate: string;
  entryNumber: string;
  entryLabel: string;
  entryStatus: string;
  lineLabel: string | null;
  journalCode: string;
  debit: number;
  credit: number;
}

interface Suggestion {
  debitLines: Array<{ id: string; amount: number; entryNumber: string; entryLabel: string }>;
  creditLines: Array<{ id: string; amount: number; entryNumber: string; entryLabel: string }>;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  confidence: 'forte' | 'moyenne';
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountLetteringPage() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [account, setAccount] = useState<{ code: string; label: string; isPostable: boolean } | null>(null);
  const [lines, setLines] = useState<UnletteredLine[] | null>(null);
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params2: Record<string, string | number> = { page };
      if (search) params2.search = search;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/accounts/${params.accountId}/unlettered-lines`, { params: params2 });
      setAccount(data.account);
      setLines(data.lines);
      setPagination(data.pagination);
    } catch {
      setError('Impossible de charger les lignes non lettrées (permission LETTERING.READ requise).');
    }
  }, [currentCompanyId, params.accountId, page, search]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  function toggleLine(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedLines = lines?.filter((l) => selected.has(l.id)) ?? [];
  const totalDebit = selectedLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = selectedLines.reduce((s, l) => s + l.credit, 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  // Contrôle purement indicatif côté frontend — le backend recalcule
  // systématiquement depuis la base et reste la seule autorité (voir
  // lettering.service.ts, jamais de montant client accepté tel quel).
  const canLetter = difference === 0 && selected.size >= 2;

  async function handleCreate() {
    setError(null);
    setIsCreating(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/lettering`, {
        accountId: params.accountId,
        lineIds: Array.from(selected),
      });
      setPendingId(data.id);
      setPendingCode(data.code);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue lors de la création du lettrage.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  async function handleConfirmClose() {
    if (!pendingId) return;
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/lettering/${pendingId}/close`);
      router.push(`/accounting/lettering/${pendingId}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      }
    }
  }

  async function handleCancelPending() {
    if (!pendingId) return;
    // Le lettrage créé mais pas encore clôturé (isBalanced=false) est
    // simplement délettré pour revenir à l'état initial — même
    // endpoint que le délettrage standard, aucun raccourci de suppression.
    try {
      await apiClient.post(`/companies/${currentCompanyId}/lettering/${pendingId}/unletter`);
    } catch {
      // best-effort
    }
    setPendingId(null);
    setPendingCode(null);
    setSelected(new Set());
    load();
  }

  async function loadSuggestions() {
    setIsLoadingSuggestions(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/lettering/suggestions`, { accountId: params.accountId });
      setSuggestions(data.suggestions);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 403) {
        setError('Permission LETTERING.AUTO requise pour les suggestions automatiques.');
      } else {
        setError('Impossible de calculer des suggestions.');
      }
    } finally {
      setIsLoadingSuggestions(false);
    }
  }

  function applySuggestion(s: Suggestion) {
    setSelected(new Set([...s.debitLines.map((l) => l.id), ...s.creditLines.map((l) => l.id)]));
    setSuggestions(null);
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
        <a href="/accounting/lettering">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Lettrage {account ? `— ${account.code} ${account.label}` : ''}</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {pendingId ? (
        <div style={{ border: '2px solid #333', padding: '1rem', marginBottom: '1rem' }}>
          <p>
            Vous êtes sur le point de clôturer le lettrage <strong>{pendingCode}</strong> pour un montant total de{' '}
            <strong>{fmt(totalDebit)}</strong>.
          </p>
          <button type="button" onClick={handleConfirmClose}>
            Confirmer
          </button>{' '}
          <button type="button" onClick={handleCancelPending}>
            Annuler
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <input placeholder="Rechercher (n° ou libellé)…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
            <button type="button" onClick={load}>
              Rechercher
            </button>
            <button type="button" onClick={loadSuggestions} disabled={isLoadingSuggestions}>
              {isLoadingSuggestions ? 'Calcul…' : 'Suggestions automatiques'}
            </button>
          </div>

          {suggestions && (
            <div style={{ border: '1px solid #ccc', padding: '0.75rem', marginBottom: '1rem' }}>
              <h3>Suggestions ({suggestions.length})</h3>
              <p style={{ fontSize: '0.85em', color: '#666' }}>
                Ce sont des propositions de rapprochement, pas des lettrages confirmés — vérifiez avant d&apos;appliquer.
              </p>
              {suggestions.length === 0 ? (
                <p style={{ fontStyle: 'italic' }}>Aucune suggestion trouvée.</p>
              ) : (
                suggestions.map((s, i) => (
                  <div key={i} style={{ borderTop: '1px solid #eee', padding: '0.5rem 0' }}>
                    <p>
                      {s.confidence === 'forte' ? 'Suggestion forte' : 'Suggestion moyenne'} — {fmt(s.totalDebit)} =
                      {' '}{fmt(s.totalCredit)}
                    </p>
                    <p style={{ fontSize: '0.85em' }}>
                      Débit : {s.debitLines.map((l) => `${l.entryNumber} (${fmt(l.amount)})`).join(', ')}
                      <br />
                      Crédit : {s.creditLines.map((l) => `${l.entryNumber} (${fmt(l.amount)})`).join(', ')}
                    </p>
                    <button type="button" onClick={() => applySuggestion(s)}>
                      Sélectionner ces lignes
                    </button>
                  </div>
                ))
              )}
              <button type="button" onClick={() => setSuggestions(null)}>
                Fermer
              </button>
            </div>
          )}

          {lines === null ? (
            <p>Chargement…</p>
          ) : lines.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune ligne non lettrée pour ce compte.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th></th>
                  <th align="left">Date</th>
                  <th align="left">Journal</th>
                  <th align="left">Pièce</th>
                  <th align="left">Libellé</th>
                  <th align="right">Débit</th>
                  <th align="right">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} style={{ background: selected.has(l.id) ? '#f0f8ff' : undefined }}>
                    <td>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleLine(l.id)} />
                    </td>
                    <td>{l.entryDate.slice(0, 10)}</td>
                    <td>{l.journalCode}</td>
                    <td>{l.entryNumber}</td>
                    <td>{l.lineLabel ?? l.entryLabel}</td>
                    <td align="right">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                    <td align="right">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div style={{ margin: '0.5rem 0' }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Précédent
              </button>{' '}
              Page {pagination.page} / {pagination.totalPages} ({pagination.total} ligne(s)){' '}
              <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Suivant
              </button>
            </div>
          )}

          <div style={{ border: '1px solid #ccc', padding: '0.75rem', marginTop: '1rem' }}>
            <p>Lignes sélectionnées : {selected.size}</p>
            <p>Total débit : {fmt(totalDebit)}</p>
            <p>Total crédit : {fmt(totalCredit)}</p>
            <p style={{ color: difference === 0 ? 'green' : 'red' }}>Différence : {fmt(difference)}</p>
            <button type="button" disabled={!canLetter || isCreating} onClick={handleCreate}>
              {isCreating ? 'Création…' : 'Créer le lettrage'}
            </button>
            {!canLetter && selected.size > 0 && (
              <p style={{ fontSize: '0.85em', color: '#a15c00' }}>
                Sélection non équilibrée — le lettrage ne peut être créé que si débit = crédit (au moins 2 lignes).
                Le reliquat reste disponible pour un futur lettrage.
              </p>
            )}
          </div>
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/lettering">Retour à la liste des comptes</a>
      </p>
    </main>
  );
}
