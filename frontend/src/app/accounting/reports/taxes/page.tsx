'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface DeclarationRow {
  id: string;
  periodLabel: string;
  status: string;
  collectedAmount: string;
  deductibleAmount: string;
  netAmount: string;
  amountDue: string;
  amountPaid: string;
  creditAmount: string;
}
interface TaxReportResponse {
  declarations: DeclarationRow[];
  totals: { collected: number; deductible: number; net: number; credit: number; due: number; paid: number; remaining: number };
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TaxReportPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState<TaxReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const { data } = await apiClient.get<TaxReportResponse>(`/companies/${currentCompanyId}/reports/taxes`, { params });
      setReport(data);
    } catch {
      setError("Impossible de charger l'analyse fiscale (permission REPORT.READ requise).");
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
      <h1>Analyse fiscale</h1>

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
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
            <tbody>
              <tr><td>TVA collectée</td><td align="right">{fmt(report.totals.collected)}</td></tr>
              <tr><td>TVA déductible</td><td align="right">{fmt(report.totals.deductible)}</td></tr>
              <tr><td>TVA nette</td><td align="right">{fmt(report.totals.net)}</td></tr>
              <tr><td>Crédit de TVA reporté</td><td align="right">{fmt(report.totals.credit)}</td></tr>
              <tr><td>Montant dû</td><td align="right">{fmt(report.totals.due)}</td></tr>
              <tr><td>Montant payé</td><td align="right">{fmt(report.totals.paid)}</td></tr>
              <tr><td><strong>Solde restant</strong></td><td align="right"><strong>{fmt(report.totals.remaining)}</strong></td></tr>
            </tbody>
          </table>

          <h2>Déclarations</h2>
          {report.declarations.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune déclaration.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Période</th>
                  <th align="left">Statut</th>
                  <th align="right">Collectée</th>
                  <th align="right">Déductible</th>
                  <th align="right">Dû</th>
                  <th align="right">Payé</th>
                </tr>
              </thead>
              <tbody>
                {report.declarations.map((d) => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/taxes/declarations/${d.id}`)}>
                    <td>{d.periodLabel}</td>
                    <td>{d.status}</td>
                    <td align="right">{fmt(d.collectedAmount)}</td>
                    <td align="right">{fmt(d.deductibleAmount)}</td>
                    <td align="right">{fmt(d.amountDue)}</td>
                    <td align="right">{fmt(d.amountPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/reports">Retour aux rapports</a>
      </p>
    </main>
  );
}
