'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface Line {
  code: string;
  label: string;
  amount: number;
}
interface Figures {
  expenseLines: Line[];
  revenueLines: Line[];
  totalExpenses: number;
  totalRevenue: number;
  netResult: number;
}
interface IncomeStatementResponse extends Figures {
  period: { startDate: string; endDate: string };
  comparison: (Figures & { period: { startDate: string; endDate: string } }) | null;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function IncomeStatementPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [comparePeriodId, setComparePeriodId] = useState('');
  const [periods, setPeriods] = useState<Array<{ id: string; name: string }>>([]);
  const [report, setReport] = useState<IncomeStatementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (comparePeriodId) params.comparePeriodId = comparePeriodId;
      const { data } = await apiClient.get<IncomeStatementResponse>(`/companies/${currentCompanyId}/reports/income-statement`, { params });
      setReport(data);
    } catch {
      setError('Impossible de charger le compte de résultat (permission REPORT.READ requise).');
      setReport(null);
    }
  }, [currentCompanyId, startDate, endDate, comparePeriodId]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      load();
      apiClient.get(`/companies/${currentCompanyId}/accounting-periods`).then(({ data }) => setPeriods(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, load]);

  function handleExport() {
    if (!currentCompanyId) return;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (comparePeriodId) params.set('comparePeriodId', comparePeriodId);
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/reports/income-statement/export?${params.toString()}`, '_blank');
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>Compte de résultat</h1>

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
          <label htmlFor="comparePeriodId">Comparer à l&apos;exercice</label>
          <br />
          <select id="comparePeriodId" value={comparePeriodId} onChange={(e) => setComparePeriodId(e.target.value)}>
            <option value="">— aucun —</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
                <th align="left">Compte</th>
                <th align="right">Montant</th>
                {report.comparison && <th align="right">Comparaison</th>}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={report.comparison ? 3 : 2}><strong>Produits</strong></td></tr>
              {report.revenueLines.map((l) => (
                <tr key={l.code}><td>{l.code} — {l.label}</td><td align="right">{fmt(l.amount)}</td>{report.comparison && <td />}</tr>
              ))}
              <tr><td><strong>Total produits</strong></td><td align="right"><strong>{fmt(report.totalRevenue)}</strong></td>{report.comparison && <td align="right"><strong>{fmt(report.comparison.totalRevenue)}</strong></td>}</tr>
              <tr><td colSpan={report.comparison ? 3 : 2}><strong>Charges</strong></td></tr>
              {report.expenseLines.map((l) => (
                <tr key={l.code}><td>{l.code} — {l.label}</td><td align="right">{fmt(l.amount)}</td>{report.comparison && <td />}</tr>
              ))}
              <tr><td><strong>Total charges</strong></td><td align="right"><strong>{fmt(report.totalExpenses)}</strong></td>{report.comparison && <td align="right"><strong>{fmt(report.comparison.totalExpenses)}</strong></td>}</tr>
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Résultat net</strong></td>
                <td align="right" style={{ color: report.netResult >= 0 ? 'green' : 'red' }}><strong>{fmt(report.netResult)}</strong></td>
                {report.comparison && <td align="right" style={{ color: report.comparison.netResult >= 0 ? 'green' : 'red' }}><strong>{fmt(report.comparison.netResult)}</strong></td>}
              </tr>
            </tfoot>
          </table>

          <p style={{ marginTop: '1rem' }}>
            <button onClick={handleExport}>Exporter en CSV</button>
          </p>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/reports">Retour aux rapports</a>
      </p>
    </main>
  );
}
