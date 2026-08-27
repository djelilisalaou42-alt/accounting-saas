'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface CashAccountRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  account: { code: string; label: string };
}

export default function CashListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [accounts, setAccounts] = useState<CashAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get(`/companies/${currentCompanyId}/cash-accounts`)
        .then(({ data }) => setAccounts(data))
        .catch(() => setError('Impossible de charger les caisses (permission CASH.READ requise).'));
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
      <h1>Caisses</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/treasury/cash/new">
          <button type="button">+ Nouvelle caisse</button>
        </a>
      </p>

      {accounts === null ? (
        <p>Chargement…</p>
      ) : accounts.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune caisse.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Nom</th>
              <th align="left">Compte comptable</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/treasury/cash/${a.id}`)}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{a.account.code} — {a.account.label}</td>
                <td>{a.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/treasury/banks">Comptes bancaires</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
