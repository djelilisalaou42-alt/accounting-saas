'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';
import { AttachmentsPanel } from '../../../../components/shared/AttachmentsPanel';

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  notes: string | null;
  customer: { name: string } | null;
  supplier: { name: string } | null;
  quote: { id: string; quoteNumber: string } | null;
  items: Array<{ id: string; description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string; account: { code: string; label: string } | null }>;
  payments: Array<{ id: string; paymentNumber: string; amount: string; paymentDate: string }>;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<InvoiceDetail>(`/companies/${currentCompanyId}/invoices/${params.id}`);
      setInvoice(data);
    } catch {
      setError('Facture introuvable.');
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

  async function handleIssue() {
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/invoices/${params.id}/issue`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Annuler cette facture ?')) return;
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/invoices/${params.id}/cancel`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !invoice) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/invoices">Retour</a>
      </main>
    );
  }
  if (!invoice) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  const remaining = Number(invoice.total) - Number(invoice.amountPaid);

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        Facture {invoice.invoiceNumber} — {invoice.status}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <table>
        <tbody>
          <tr>
            <td>{invoice.invoiceType === 'SALE' ? 'Client' : 'Fournisseur'}</td>
            <td>{invoice.customer?.name ?? invoice.supplier?.name}</td>
          </tr>
          <tr>
            <td>Date</td>
            <td>{invoice.issueDate.slice(0, 10)}</td>
          </tr>
          <tr>
            <td>Échéance</td>
            <td>{invoice.dueDate.slice(0, 10)}</td>
          </tr>
          {invoice.quote && (
            <tr>
              <td>Devis d&apos;origine</td>
              <td>
                <a href={`/accounting/quotes/${invoice.quote.id}`}>{invoice.quote.quoteNumber}</a>
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
            <th align="left">Compte</th>
            <th align="right">Qté</th>
            <th align="right">P.U.</th>
            <th align="right">TVA %</th>
            <th align="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it) => (
            <tr key={it.id}>
              <td>{it.description}</td>
              <td>{it.account ? it.account.code : '—'}</td>
              <td align="right">{it.quantity}</td>
              <td align="right">{fmt(Number(it.unitPrice))}</td>
              <td align="right">{it.taxRate}</td>
              <td align="right">{fmt(Number(it.lineTotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Total HT : {fmt(Number(invoice.subtotal))} — TVA : {fmt(Number(invoice.taxTotal))} — <strong>Total TTC : {fmt(Number(invoice.total))}</strong>
      </p>
      <p>
        Payé : {fmt(Number(invoice.amountPaid))} — Restant dû : <strong>{fmt(remaining)}</strong>
      </p>

      {invoice.payments.length > 0 && (
        <>
          <h2>Paiements</h2>
          <ul>
            {invoice.payments.map((p) => (
              <li key={p.id}>
                <a href={`/accounting/payments/${p.id}`}>{p.paymentNumber}</a> — {p.paymentDate.slice(0, 10)} — {fmt(Number(p.amount))}
              </li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: '1rem' }}>
        {invoice.status === 'DRAFT' && (
          <button type="button" onClick={handleIssue} disabled={isProcessing}>
            Émettre (génère l&apos;écriture comptable)
          </button>
        )}
        {invoice.status !== 'PAID' && invoice.status !== 'PARTIALLY_PAID' && invoice.status !== 'CANCELLED' && (
          <>
            {' '}
            <button type="button" onClick={handleCancel} disabled={isProcessing}>
              Annuler
            </button>
          </>
        )}
        {remaining > 0 && invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED' && (
          <>
            {' '}
            <a href={`/accounting/payments/new?invoiceId=${invoice.id}`}>
              <button type="button">Enregistrer un paiement</button>
            </a>
          </>
        )}
      </div>

      <AttachmentsPanel companyId={currentCompanyId!} entityType="invoice" entityId={invoice.id} />

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/invoices">Retour à la liste des factures</a>
      </p>
    </main>
  );
}
