'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface BudgetRow {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  period: { name: string };
  lines: Array<{ id: string }>;
}

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Brouillon', ACTIVE: 'Actif', CLOSED: 'Clôturé' };

export default function BudgetsListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [budgets, setBudgets] = useState<BudgetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get(`/companies/${currentCompanyId}/budgets`)
        .then(({ data }) => setBudgets(data))
        .catch(() => setError('Impossible de charger les budgets (permission BUDGET.READ requise).'));
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
      <h1>Budgets</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/accounting/budgets/new">
          <button type="button">+ Nouveau budget</button>
        </a>
      </p>

      {budgets === null ? (
        <p>Chargement…</p>
      ) : budgets.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun budget.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Nom</th>
              <th align="left">Exercice</th>
              <th align="right">Lignes</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/budgets/${b.id}`)}>
                <td>{b.name}</td>
                <td>{b.period.name}</td>
                <td align="right">{b.lines.length}</td>
                <td>{STATUS_LABELS[b.status] ?? b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
