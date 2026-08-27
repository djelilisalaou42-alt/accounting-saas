'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

interface Movement {
  id: string;
  type: string;
  amount: string;
  transactionDate: string;
  label: string;
  reference: string | null;
  isReconciled: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankMovementsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get(`/companies/${currentCompanyId}/bank-accounts/${params.id}/movements`)
        .then(({ data }) => setMovements(data.transactions))
        .catch(() => setError('Impossible de charger les mouvements (permission BANK.MOVEMENT.READ requise).'));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>Historique des mouvements bancaires</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {movements === null ? (
        <p>Chargement…</p>
      ) : movements.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun mouvement.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Date</th>
              <th align="left">Type</th>
              <th align="left">Libellé</th>
              <th align="left">Référence</th>
              <th align="right">Montant</th>
              <th align="left">Rapproché</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{m.transactionDate.slice(0, 10)}</td>
                <td>{m.type === 'CREDIT' ? 'Encaissement' : 'Décaissement'}</td>
                <td>{m.label}</td>
                <td>{m.reference ?? '—'}</td>
                <td align="right">{fmt(Number(m.amount))}</td>
                <td>{m.isReconciled ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href={`/treasury/banks/${params.id}`}>Retour au compte bancaire</a>
      </p>
    </main>
  );
}
