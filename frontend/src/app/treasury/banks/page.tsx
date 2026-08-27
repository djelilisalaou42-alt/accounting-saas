'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface BankAccountRow {
  id: string;
  code: string;
  name: string;
  bankName: string;
  accountNumber: string | null;
  isActive: boolean;
  account: { code: string; label: string };
}

export default function BankListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get(`/companies/${currentCompanyId}/bank-accounts`)
        .then(({ data }) => setAccounts(data))
        .catch(() => setError('Impossible de charger les comptes bancaires (permission BANK.READ requise).'));
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
      <h1>Comptes bancaires</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/treasury/banks/new">
          <button type="button">+ Nouveau compte bancaire</button>
        </a>
      </p>

      {accounts === null ? (
        <p>Chargement…</p>
      ) : accounts.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun compte bancaire.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Nom</th>
              <th align="left">Banque</th>
              <th align="left">N° compte</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/treasury/banks/${a.id}`)}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{a.bankName}</td>
                <td>{a.accountNumber ?? '—'}</td>
                <td>{a.isActive ? 'Actif' : 'Inactif'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/treasury/cash">Caisses</a> · <a href="/treasury/reconciliation">Rapprochements</a> · <a href="/">Accueil</a>
      </p>
    </main>
  );
}
