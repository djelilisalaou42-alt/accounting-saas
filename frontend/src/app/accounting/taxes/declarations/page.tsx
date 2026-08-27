'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface DeclarationRow {
  id: string;
  periodLabel: string;
  status: 'DRAFT' | 'SUBMITTED' | 'PAID' | 'LATE';
  amountDue: string;
  amountPaid: string;
  dueDate: string;
  tax: { code: string; label: string };
}

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Brouillon', SUBMITTED: 'Soumise', PAID: 'Payée', LATE: 'En retard' };

function fmt(n: string | number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TaxDeclarationsListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [declarations, setDeclarations] = useState<DeclarationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get(`/companies/${currentCompanyId}/tax-declarations`)
        .then(({ data }) => setDeclarations(data))
        .catch(() => setError('Impossible de charger les déclarations (permission TAX.READ requise).'));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Déclarations fiscales</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/accounting/taxes/declarations/new">
          <button type="button">+ Nouvelle déclaration</button>
        </a>
      </p>

      {declarations === null ? (
        <p>Chargement…</p>
      ) : declarations.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune déclaration.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Période</th>
              <th align="left">Taxe</th>
              <th align="right">Montant dû</th>
              <th align="right">Payé</th>
              <th align="left">Échéance</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {declarations.map((d) => (
              <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/taxes/declarations/${d.id}`)}>
                <td>{d.periodLabel}</td>
                <td>{d.tax.code}</td>
                <td align="right">{fmt(d.amountDue)}</td>
                <td align="right">{fmt(d.amountPaid)}</td>
                <td>{d.dueDate.slice(0, 10)}</td>
                <td>{STATUS_LABELS[d.status] ?? d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/taxes">Retour aux taxes</a>
      </p>
    </main>
  );
}
