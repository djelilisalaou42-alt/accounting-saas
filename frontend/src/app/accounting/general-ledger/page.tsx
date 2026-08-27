'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}

interface Journal {
  id: string;
  code: string;
  label: string;
}

interface Movement {
  entryDate: string;
  entryNumber: string;
  entryLabel: string;
  lineLabel: string | null;
  journal: { code: string; label: string };
  debit: number;
  credit: number;
  balance: number;
  letteringCode: string | null;
}

interface LedgerResponse {
  account: { code: string; label: string; classCode: string; isPostable: boolean; isActive: boolean };
  period: { startDate: string; endDate: string };
  openingBalance: { amount: number; side: 'DEBIT' | 'CREDIT' };
  movements: Movement[];
  totals: { totalDebit: number; totalCredit: number };
  closingBalance: { amount: number; side: 'DEBIT' | 'CREDIT' };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GeneralLedgerPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [journalId, setJournalId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data));
      apiClient.get(`/companies/${currentCompanyId}/journals`).then(({ data }) => setJournals(data));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  const loadLedger = useCallback(async () => {
    if (!currentCompanyId || !accountId) return;
    setIsLoadingLedger(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (journalId) params.journalId = journalId;
      if (search) params.search = search;
      const { data } = await apiClient.get<LedgerResponse>(`/companies/${currentCompanyId}/reports/accounts/${accountId}/ledger`, { params });
      setLedger(data);
    } catch {
      setError('Impossible de charger le grand livre pour ce compte (permission REPORT.READ requise).');
      setLedger(null);
    } finally {
      setIsLoadingLedger(false);
    }
  }, [currentCompanyId, accountId, startDate, endDate, journalId, search, page]);

  useEffect(() => {
    if (accountId) loadLedger();
  }, [accountId, loadLedger]);

  function handleSearch() {
    setPage(1);
    loadLedger();
  }

  function handleExport() {
    if (!currentCompanyId || !accountId) return;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (journalId) params.set('journalId', journalId);
    window.open(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/reports/accounts/${accountId}/ledger/export?${params.toString()}`,
      '_blank',
    );
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour consulter son grand livre.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Grand livre</h1>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="account">Compte</label>
          <br />
          <select id="account" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
            <option value="">— choisir un compte —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="startDate">Du</label>
          <br />
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="endDate">Au</label>
          <br />
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="journal">Journal</label>
          <br />
          <select id="journal" value={journalId} onChange={(e) => setJournalId(e.target.value)}>
            <option value="">Tous</option>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search">Recherche (n° ou libellé)</label>
          <br />
          <input id="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={handleSearch}>Rechercher</button>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      {!accountId && <p>Choisissez un compte pour afficher son grand livre.</p>}
      {isLoadingLedger && <p>Chargement…</p>}

      {ledger && (
        <>
          <h2>
            {ledger.account.code} — {ledger.account.label}
            {!ledger.account.isPostable && ' (compte de regroupement — aucun mouvement direct attendu)'}
          </h2>
          <p>
            Période : {ledger.period.startDate.slice(0, 10)} → {ledger.period.endDate.slice(0, 10)}
          </p>
          <p>
            Solde initial : <strong>{fmt(ledger.openingBalance.amount)}</strong> ({ledger.openingBalance.side === 'DEBIT' ? 'débiteur' : 'créditeur'})
          </p>

          {ledger.movements.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucun mouvement sur la période sélectionnée.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Journal</th>
                  <th align="left">N° écriture</th>
                  <th align="left">Libellé</th>
                  <th align="right">Débit</th>
                  <th align="right">Crédit</th>
                  <th align="right">Solde</th>
                  <th align="left">Lettrage</th>
                </tr>
              </thead>
              <tbody>
                {ledger.movements.map((m, i) => (
                  <tr key={i}>
                    <td>{m.entryDate.slice(0, 10)}</td>
                    <td>{m.journal.code}</td>
                    <td>{m.entryNumber}</td>
                    <td>{m.lineLabel ?? m.entryLabel}</td>
                    <td align="right">{m.debit > 0 ? fmt(m.debit) : ''}</td>
                    <td align="right">{m.credit > 0 ? fmt(m.credit) : ''}</td>
                    <td align="right">{fmt(Math.abs(m.balance))} {m.balance >= 0 ? 'D' : 'C'}</td>
                    <td>{m.letteringCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} align="right">
                    <strong>TOTAUX</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(ledger.totals.totalDebit)}</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(ledger.totals.totalCredit)}</strong>
                  </td>
                  <td align="right">
                    <strong>
                      {fmt(ledger.closingBalance.amount)} {ledger.closingBalance.side === 'DEBIT' ? 'D' : 'C'}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {ledger.pagination.totalPages > 1 && (
            <div style={{ marginTop: '0.5rem' }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Précédent
              </button>{' '}
              Page {ledger.pagination.page} / {ledger.pagination.totalPages} ({ledger.pagination.total} mouvement(s)){' '}
              <button disabled={page >= ledger.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Suivant
              </button>
            </div>
          )}

          <p style={{ marginTop: '1rem' }}>
            <button onClick={handleExport}>Exporter en CSV</button>
          </p>
        </>
      )}

      <p>
        <a href="/accounting/trial-balance">Voir la balance générale</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
