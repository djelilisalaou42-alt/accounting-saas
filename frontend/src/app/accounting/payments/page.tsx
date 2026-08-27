'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface Payment {
  id: string;
  paymentNumber: string;
  direction: string;
  method: string;
  amount: string;
  paymentDate: string;
  customer: { name: string } | null;
  supplier: { name: string } | null;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PaymentsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [directionFilter, setDirectionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params: Record<string, string> = {};
      if (directionFilter) params.direction = directionFilter;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/payments`, { params });
      setPayments(data.payments);
    } catch {
      setError('Impossible de charger les paiements (permission PAYMENT.READ requise).');
    }
  }, [currentCompanyId, directionFilter]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Paiements</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
          <option value="">Tous</option>
          <option value="INCOMING">Encaissements</option>
          <option value="OUTGOING">Décaissements</option>
        </select>
        <a href="/accounting/payments/new">
          <button type="button">+ Nouveau paiement</button>
        </a>
      </div>

      {payments === null ? (
        <p>Chargement…</p>
      ) : payments.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun paiement.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">N°</th>
              <th align="left">Sens</th>
              <th align="left">Tiers</th>
              <th align="left">Date</th>
              <th align="right">Montant</th>
              <th align="left">Mode</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/payments/${p.id}`)}>
                <td>{p.paymentNumber}</td>
                <td>{p.direction === 'INCOMING' ? 'Encaissement' : 'Décaissement'}</td>
                <td>{p.customer?.name ?? p.supplier?.name ?? '—'}</td>
                <td>{p.paymentDate.slice(0, 10)}</td>
                <td align="right">{fmt(Number(p.amount))}</td>
                <td>{p.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/invoices">Factures</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
