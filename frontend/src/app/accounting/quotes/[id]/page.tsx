'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface QuoteDetail {
  id: string;
  quoteNumber: string;
  issueDate: string;
  expiryDate: string | null;
  status: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  customer: { code: string; name: string };
  items: Array<{ id: string; description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }>;
  invoice: { id: string; invoiceNumber: string } | null;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<QuoteDetail>(`/companies/${currentCompanyId}/quotes/${params.id}`);
      setQuote(data);
    } catch {
      setError('Devis introuvable.');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, params.id]);

  async function handleAction(action: 'send' | 'accept' | 'reject' | 'cancel' | 'convert') {
    setIsProcessing(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/quotes/${params.id}/${action}`);
      if (action === 'convert') {
        router.push(`/accounting/invoices/${data.id}`);
        return;
      }
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !quote) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/quotes">Retour</a>
      </main>
    );
  }
  if (!quote) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        Devis {quote.quoteNumber} — {quote.status}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <table>
        <tbody>
          <tr>
            <td>Client</td>
            <td>{quote.customer.name}</td>
          </tr>
          <tr>
            <td>Date</td>
            <td>{quote.issueDate.slice(0, 10)}</td>
          </tr>
          {quote.expiryDate && (
            <tr>
              <td>Expire le</td>
              <td>{quote.expiryDate.slice(0, 10)}</td>
            </tr>
          )}
          {quote.invoice && (
            <tr>
              <td>Facture</td>
              <td>
                <a href={`/accounting/invoices/${quote.invoice.id}`}>{quote.invoice.invoiceNumber}</a>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Lignes</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Description</th>
            <th align="right">Quantité</th>
            <th align="right">Prix unitaire</th>
            <th align="right">TVA %</th>
            <th align="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((it) => (
            <tr key={it.id}>
              <td>{it.description}</td>
              <td align="right">{it.quantity}</td>
              <td align="right">{fmt(Number(it.unitPrice))}</td>
              <td align="right">{it.taxRate}</td>
              <td align="right">{fmt(Number(it.lineTotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Total HT : {fmt(Number(quote.subtotal))} — TVA : {fmt(Number(quote.taxTotal))} — <strong>Total TTC : {fmt(Number(quote.total))}</strong>
      </p>

      <div style={{ marginTop: '1rem' }}>
        {quote.status === 'DRAFT' && (
          <>
            <button type="button" onClick={() => handleAction('send')} disabled={isProcessing}>
              Envoyer
            </button>{' '}
            <button type="button" onClick={() => handleAction('cancel')} disabled={isProcessing}>
              Annuler
            </button>
          </>
        )}
        {quote.status === 'SENT' && (
          <>
            <button type="button" onClick={() => handleAction('accept')} disabled={isProcessing}>
              Marquer accepté
            </button>{' '}
            <button type="button" onClick={() => handleAction('reject')} disabled={isProcessing}>
              Marquer refusé
            </button>
          </>
        )}
        {quote.status === 'ACCEPTED' && !quote.invoice && (
          <button type="button" onClick={() => handleAction('convert')} disabled={isProcessing}>
            Convertir en facture
          </button>
        )}
      </div>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/quotes">Retour à la liste des devis</a>
      </p>
    </main>
  );
}
