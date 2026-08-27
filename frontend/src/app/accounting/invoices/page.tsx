'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate: string;
  dueDate: string;
  status: string;
  total: string;
  amountPaid: string;
  customer: { name: string } | null;
  supplier: { name: string } | null;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InvoicesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.invoiceType = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/invoices`, { params });
      setInvoices(data.invoices);
    } catch {
      setError('Impossible de charger les factures (permission INVOICE.READ requise).');
    }
  }, [currentCompanyId, typeFilter, statusFilter]);

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
      <h1>Factures</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Tous types</option>
          <option value="SALE">Vente</option>
          <option value="PURCHASE">Achat</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="DRAFT">Brouillon</option>
          <option value="SENT">Émise</option>
          <option value="PARTIALLY_PAID">Partiellement payée</option>
          <option value="PAID">Payée</option>
          <option value="CANCELLED">Annulée</option>
        </select>
        <a href="/accounting/invoices/new">
          <button type="button">+ Nouvelle facture</button>
        </a>
      </div>

      {invoices === null ? (
        <p>Chargement…</p>
      ) : invoices.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune facture.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">N°</th>
              <th align="left">Type</th>
              <th align="left">Tiers</th>
              <th align="left">Échéance</th>
              <th align="right">Total</th>
              <th align="right">Payé</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/invoices/${inv.id}`)}>
                <td>{inv.invoiceNumber}</td>
                <td>{inv.invoiceType === 'SALE' ? 'Vente' : 'Achat'}</td>
                <td>{inv.customer?.name ?? inv.supplier?.name ?? '—'}</td>
                <td>{inv.dueDate.slice(0, 10)}</td>
                <td align="right">{fmt(Number(inv.total))}</td>
                <td align="right">{fmt(Number(inv.amountPaid))}</td>
                <td>{inv.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/payments">Paiements</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
