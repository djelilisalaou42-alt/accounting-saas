'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface TreasuryReportResponse {
  period: { startDate: string; endDate: string };
  cash: { accountsCount: number; receipts: number; disbursements: number; balance: number };
  bank: { accountsCount: number; receipts: number; disbursements: number; balance: number };
  totals: { totalReceipts: number; totalDisbursements: number; totalBalance: number };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TreasuryReportPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState<TreasuryReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const { data } = await apiClient.get<TreasuryReportResponse>(`/companies/${currentCompanyId}/reports/treasury`, { params });
      setReport(data);
    } catch {
      setError("Impossible de charger l'analyse de trésorerie (permission REPORT.READ requise).");
      setReport(null);
    }
  }, [currentCompanyId, startDate, endDate]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>Analyse de trésorerie</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
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
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={load}>Rechercher</button>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {report && (
        <>
          <p>Période : {report.period.startDate.toString().slice(0, 10)} → {report.period.endDate.toString().slice(0, 10)}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left"></th>
                <th align="right">Encaissements</th>
                <th align="right">Décaissements</th>
                <th align="right">Solde</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Caisse ({report.cash.accountsCount} compte(s))</td>
                <td align="right">{fmt(report.cash.receipts)}</td>
                <td align="right">{fmt(report.cash.disbursements)}</td>
                <td align="right">{fmt(report.cash.balance)}</td>
              </tr>
              <tr>
                <td>Banque ({report.bank.accountsCount} compte(s))</td>
                <td align="right">{fmt(report.bank.receipts)}</td>
                <td align="right">{fmt(report.bank.disbursements)}</td>
                <td align="right">{fmt(report.bank.balance)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td align="right"><strong>{fmt(report.totals.totalReceipts)}</strong></td>
                <td align="right"><strong>{fmt(report.totals.totalDisbursements)}</strong></td>
                <td align="right"><strong>{fmt(report.totals.totalBalance)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/reports">Retour aux rapports</a>{' '}·{' '}
        <a href="/treasury/cash">Caisse</a> · <a href="/treasury/banks">Banques</a>
      </p>
    </main>
  );
}
