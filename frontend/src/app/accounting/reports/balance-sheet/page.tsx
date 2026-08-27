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
  classCode: string;
}
interface BalanceSheetResponse {
  asOfDate: string;
  asset: Line[];
  liability: Line[];
  equity: Line[];
  totals: { totalAsset: number; totalLiability: number; totalEquity: number; totalPassif: number; gap: number };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BalanceSheetPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState<BalanceSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (endDate) params.endDate = endDate;
      const { data } = await apiClient.get<BalanceSheetResponse>(`/companies/${currentCompanyId}/reports/balance-sheet`, { params });
      setReport(data);
    } catch {
      setError('Impossible de charger le bilan (permission REPORT.READ requise).');
      setReport(null);
    }
  }, [currentCompanyId, endDate]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  function handleExport() {
    if (!currentCompanyId) return;
    const params = new URLSearchParams();
    if (endDate) params.set('endDate', endDate);
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/reports/balance-sheet/export?${params.toString()}`, '_blank');
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
      <h1>Bilan</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="endDate">À la date du</label>
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
          <p>Situation au {report.asOfDate.toString().slice(0, 10)}</p>
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h2>Actif</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {report.asset.map((l) => (
                    <tr key={l.code}><td>{l.code} — {l.label}</td><td align="right">{fmt(l.amount)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total actif</strong></td><td align="right"><strong>{fmt(report.totals.totalAsset)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
            <div style={{ flex: 1 }}>
              <h2>Passif</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td colSpan={2}><strong>Dettes</strong></td></tr>
                  {report.liability.map((l) => (
                    <tr key={l.code}><td>{l.code} — {l.label}</td><td align="right">{fmt(l.amount)}</td></tr>
                  ))}
                  <tr><td colSpan={2}><strong>Capitaux propres</strong></td></tr>
                  {report.equity.map((l) => (
                    <tr key={l.code}><td>{l.code} — {l.label}</td><td align="right">{fmt(l.amount)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total passif</strong></td><td align="right"><strong>{fmt(report.totals.totalPassif)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p style={{ marginTop: '1rem' }}>
            {report.totals.gap === 0 ? (
              <span style={{ color: 'green' }}>✓ Actif = Passif</span>
            ) : (
              <span style={{ color: '#b8860b' }}>
                Écart actif/passif : {fmt(report.totals.gap)} — correspond au résultat non affecté (aucune écriture de clôture/affectation dans ce logiciel)
              </span>
            )}
          </p>

          <p>
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
