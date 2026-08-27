'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface DashboardResponse {
  period: { startDate: string; endDate: string };
  summary: { revenue: number; expenses: number; profit: number; cashAvailable: number };
  cash: { cash: { balance: number }; bank: { balance: number } };
  receivables: { total: number; unpaidCount: number; overdueCount: number };
  payables: { total: number; unpaidCount: number; overdueCount: number };
  taxes: { collected: number; deductible: number; net: number; credit: number; due: number; paid: number; remaining: number };
  budget: { planned: number; actual: number; variance: number; consumptionRate: number | null };
  fixedAssets: { grossValue: number; accumulatedDepreciation: number; netBookValue: number; acquiredNotInServiceCount: number };
  draftEntriesCount: number;
  charts: {
    revenueExpenses: Array<{ month: string; revenue: number; expenses: number; result: number }>;
    treasuryEvolution: Array<{ month: string; delta: number }>;
  };
  alerts: Array<{ level: 'info' | 'warning' | 'critical'; message: string }>;
}
interface PeriodOption {
  id: string;
  name: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const ALERT_COLORS: Record<string, string> = { info: '#2563eb', warning: '#b8860b', critical: '#dc2626' };

export default function DashboardPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [periodId, setPeriodId] = useState('');
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (periodId) params.periodId = periodId;
      const { data } = await apiClient.get<DashboardResponse>(`/companies/${currentCompanyId}/dashboard`, { params });
      setData(data);
    } catch {
      setError('Impossible de charger le tableau de bord (permission REPORT.READ requise).');
      setData(null);
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
      <main style={{ maxWidth: 1100, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: '4rem auto' }}>
      <h1>Tableau de bord</h1>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="periodId">Exercice</label>
        <br />
        <select id="periodId" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">Exercice ouvert (par défaut)</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {data && (
        <>
          <p style={{ color: '#666' }}>
            Période : {data.period.startDate.toString().slice(0, 10)} → {data.period.endDate.toString().slice(0, 10)}
          </p>

          {/* Indicateurs principaux */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', margin: '1.5rem 0' }}>
            <Kpi label="Trésorerie disponible" value={fmt(data.summary.cashAvailable)} sub={`Caisse ${fmt(data.cash.cash.balance)} + Banque ${fmt(data.cash.bank.balance)}`} />
            <Kpi label="Chiffre d'affaires" value={fmt(data.summary.revenue)} />
            <Kpi label="Charges" value={fmt(data.summary.expenses)} />
            <Kpi label="Résultat" value={fmt(data.summary.profit)} color={data.summary.profit >= 0 ? 'green' : 'red'} />
            <Kpi label="Créances clients" value={fmt(data.receivables.total)} sub={`${data.receivables.overdueCount} échue(s)`} />
            <Kpi label="Dettes fournisseurs" value={fmt(data.payables.total)} sub={`${data.payables.overdueCount} échue(s)`} />
            <Kpi label="TVA nette / restant dû" value={fmt(data.taxes.net)} sub={`Solde restant : ${fmt(data.taxes.remaining)}`} />
            <Kpi label="Budget consommé" value={data.budget.consumptionRate !== null ? `${data.budget.consumptionRate}%` : '—'} sub={`${fmt(data.budget.actual)} / ${fmt(data.budget.planned)}`} />
            <Kpi label="Immobilisations (VNC)" value={fmt(data.fixedAssets.netBookValue)} sub={`Brut ${fmt(data.fixedAssets.grossValue)}`} />
          </div>

          {/* Points d'attention */}
          {data.alerts.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h2>Points d&apos;attention</h2>
              <ul>
                {data.alerts.map((a, i) => (
                  <li key={i} style={{ color: ALERT_COLORS[a.level] }}>{a.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Graphiques */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
            <div>
              <h3>Évolution CA / charges / résultat</h3>
              {data.charts.revenueExpenses.length === 0 ? (
                <p style={{ fontStyle: 'italic', color: '#666' }}>Aucune donnée sur la période.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={data.charts.revenueExpenses}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name="CA" stroke="#2563eb" />
                    <Line type="monotone" dataKey="expenses" name="Charges" stroke="#dc2626" />
                    <Line type="monotone" dataKey="result" name="Résultat" stroke="#16a34a" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div>
              <h3>Évolution de la trésorerie</h3>
              {data.charts.treasuryEvolution.length === 0 ? (
                <p style={{ fontStyle: 'italic', color: '#666' }}>Aucune donnée sur la période.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.charts.treasuryEvolution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="delta" name="Variation nette" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div>
              <h3>Budget vs réalisé</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[{ name: 'Budget', Budgété: data.budget.planned, Réalisé: data.budget.actual }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Budgété" fill="#94a3b8" />
                  <Bar dataKey="Réalisé" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <p style={{ color: '#666' }}>{data.draftEntriesCount} écriture(s) en brouillon sur la période.</p>

          <p style={{ marginTop: '1rem' }}>
            <a href="/accounting/reports">Voir les rapports détaillés</a> ·{' '}
            <a href="/accounting/audit-log">Journal d&apos;audit</a>
          </p>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '1rem' }}>
      <div style={{ fontSize: '0.85rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: color ?? 'inherit' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.8rem', color: '#999' }}>{sub}</div>}
    </div>
  );
}
