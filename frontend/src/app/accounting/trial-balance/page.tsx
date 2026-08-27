'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface TrialBalanceLine {
  accountId: string;
  code: string;
  label: string;
  classCode: string;
  periodDebit: number;
  periodCredit: number;
  debitBalance: number;
  creditBalance: number;
}

interface TrialBalanceResponse {
  period: { startDate: string; endDate: string };
  lines: TrialBalanceLine[];
  totals: { totalPeriodDebit: number; totalPeriodCredit: number; totalDebitBalance: number; totalCreditBalance: number };
  integrity: { periodBalanced: boolean; cumulativeBalanced: boolean; periodGap: number; cumulativeGap: number };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TrialBalancePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [classCode, setClassCode] = useState('');
  const [search, setSearch] = useState('');
  const [classOptions, setClassOptions] = useState<Array<{ code: string; name: string }>>([]);

  const [balance, setBalance] = useState<TrialBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadBalance = useCallback(async () => {
    if (!currentCompanyId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (classCode) params.classCode = classCode;
      if (search) params.search = search;
      const { data } = await apiClient.get<TrialBalanceResponse>(`/companies/${currentCompanyId}/reports/trial-balance`, { params });
      setBalance(data);
    } catch {
      setError('Impossible de charger la balance (permission REPORT.READ requise).');
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [currentCompanyId, startDate, endDate, classCode, search]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      loadBalance();
      apiClient.get('/accounting-frameworks').then(({ data }) => {
        const active = data.find((f: any) => f.isActive);
        if (active) setClassOptions(active.accountClasses.map((c: any) => ({ code: c.code, name: c.name })));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId]);

  function handleExport() {
    if (!currentCompanyId) return;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (classCode) params.set('classCode', classCode);
    window.open(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/reports/trial-balance/export?${params.toString()}`,
      '_blank',
    );
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour consulter sa balance.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Balance générale</h1>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
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
          <label htmlFor="classCode">Classe</label>
          <br />
          <select id="classCode" value={classCode} onChange={(e) => setClassCode(e.target.value)}>
            <option value="">Toutes</option>
            {classOptions.map((c) => (
              <option key={c.code} value={c.code}>
                Classe {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search">Compte (code ou libellé)</label>
          <br />
          <input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="401" />
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={loadBalance}>Rechercher</button>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      {isLoading && <p>Chargement…</p>}

      {balance && (
        <>
          <p>
            Période : {balance.period.startDate.slice(0, 10)} → {balance.period.endDate.slice(0, 10)}
          </p>

          {balance.lines.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucun compte mouvementé sur cette période.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Code</th>
                  <th align="left">Compte</th>
                  <th align="right">Débit période</th>
                  <th align="right">Crédit période</th>
                  <th align="right">Solde débiteur</th>
                  <th align="right">Solde créditeur</th>
                </tr>
              </thead>
              <tbody>
                {balance.lines.map((l) => (
                  <tr key={l.accountId}>
                    <td>{l.code}</td>
                    <td>{l.label}</td>
                    <td align="right">{l.periodDebit > 0 ? fmt(l.periodDebit) : ''}</td>
                    <td align="right">{l.periodCredit > 0 ? fmt(l.periodCredit) : ''}</td>
                    <td align="right">{l.debitBalance > 0 ? fmt(l.debitBalance) : ''}</td>
                    <td align="right">{l.creditBalance > 0 ? fmt(l.creditBalance) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} align="right">
                    <strong>TOTAL</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(balance.totals.totalPeriodDebit)}</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(balance.totals.totalPeriodCredit)}</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(balance.totals.totalDebitBalance)}</strong>
                  </td>
                  <td align="right">
                    <strong>{fmt(balance.totals.totalCreditBalance)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <p style={{ marginTop: '1rem' }}>
            {balance.integrity.periodBalanced && balance.integrity.cumulativeBalanced ? (
              <span style={{ color: 'green' }}>✓ Balance équilibrée</span>
            ) : (
              <span style={{ color: 'red' }}>
                ⚠ Écart détecté : période {fmt(balance.integrity.periodGap)}, cumulé {fmt(balance.integrity.cumulativeGap)}
              </span>
            )}
          </p>

          <p>
            <button onClick={handleExport}>Exporter en CSV</button>
          </p>
        </>
      )}

      <p>
        <a href="/accounting/general-ledger">Voir le grand livre</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
