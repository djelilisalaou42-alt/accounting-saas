'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface Quote {
  id: string;
  quoteNumber: string;
  issueDate: string;
  status: string;
  total: string;
  customer: { code: string; name: string };
  invoice: { id: string; invoiceNumber: string } | null;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/quotes`, { params });
      setQuotes(data.quotes);
    } catch {
      setError('Impossible de charger les devis (permission QUOTE.READ requise).');
    }
  }, [currentCompanyId, statusFilter]);

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
      <h1>Devis</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="DRAFT">Brouillon</option>
          <option value="SENT">Envoyé</option>
          <option value="ACCEPTED">Accepté</option>
          <option value="REFUSED">Refusé</option>
          <option value="CANCELLED">Annulé</option>
        </select>
        <a href="/accounting/quotes/new">
          <button type="button">+ Nouveau devis</button>
        </a>
      </div>

      {quotes === null ? (
        <p>Chargement…</p>
      ) : quotes.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun devis.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">N°</th>
              <th align="left">Date</th>
              <th align="left">Client</th>
              <th align="right">Total</th>
              <th align="left">Statut</th>
              <th align="left">Facture</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/quotes/${q.id}`)}>
                <td>{q.quoteNumber}</td>
                <td>{q.issueDate.slice(0, 10)}</td>
                <td>{q.customer.name}</td>
                <td align="right">{fmt(Number(q.total))}</td>
                <td>{q.status}</td>
                <td>{q.invoice ? q.invoice.invoiceNumber : '—'}</td>
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
