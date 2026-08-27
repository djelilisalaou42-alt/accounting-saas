'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface BudgetSummary {
  id: string;
  name: string;
  period: { name: string };
  summary: { totalPlanned: number; totalActual: number; totalVariance: number; consumptionRate: number | null };
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BudgetReportPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [periodId, setPeriodId] = useState('');
  const [periods, setPeriods] = useState<Array<{ id: string; name: string }>>([]);
  const [budgets, setBudgets] = useState<BudgetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (periodId) params.periodId = periodId;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/reports/budget`, { params });
      setBudgets(data.budgets ?? [data]);
    } catch {
      setError('Impossible de charger l\'analyse budgétaire (permission REPORT.READ requise).');
      setBudgets(null);
    }
  }, [currentCompanyId, periodId]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      load();
      apiClient.get(`/companies/${currentCompanyId}/accounting-periods`).then(({ data }) => setPeriods(data));
    }
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
      <h1>Analyse budgétaire</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="periodId">Exercice</label>
          <br />
          <select id="periodId" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Tous</option>
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

      {budgets && (
        budgets.length === 0 ? (
          <p style={{ fontStyle: 'italic' }}>Aucun budget.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Budget</th>
                <th align="left">Exercice</th>
                <th align="right">Budgété</th>
                <th align="right">Réalisé</th>
                <th align="right">Écart</th>
                <th align="right">Taux</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/budgets/${b.id}`)}>
                  <td>{b.name}</td>
                  <td>{b.period.name}</td>
                  <td align="right">{fmt(b.summary.totalPlanned)}</td>
                  <td align="right">{fmt(b.summary.totalActual)}</td>
                  <td align="right" style={{ color: b.summary.totalVariance > 0 ? 'red' : 'green' }}>{fmt(b.summary.totalVariance)}</td>
                  <td align="right">{b.summary.consumptionRate !== null ? `${b.summary.consumptionRate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/reports">Retour aux rapports</a>
      </p>
    </main>
  );
}
