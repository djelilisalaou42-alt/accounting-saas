'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface PaymentDetail {
  id: string;
  paymentNumber: string;
  direction: string;
  method: string;
  amount: string;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
  customer: { name: string } | null;
  supplier: { name: string } | null;
  allocations: Array<{ id: string; amount: string; invoice: { id: string; invoiceNumber: string; total: string } }>;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<PaymentDetail>(`/companies/${currentCompanyId}/payments/${params.id}`);
      setPayment(data);
    } catch {
      setError('Paiement introuvable.');
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

  async function handleCancel() {
    if (!window.confirm(`Annuler le paiement ${payment?.paymentNumber} ?`)) return;
    setIsProcessing(true);
    setError(null);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/payments/${params.id}/cancel`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    } finally {
      setIsProcessing(false);
    }
  }

  if (error && !payment) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/payments">Retour</a>
      </main>
    );
  }
  if (!payment) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  const isCancelled = (payment.notes ?? '').startsWith('[ANNULÉ]');

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>
        Paiement {payment.paymentNumber} {isCancelled && '— Annulé'}
      </h1>
      {error && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}

      <table>
        <tbody>
          <tr>
            <td>Sens</td>
            <td>{payment.direction === 'INCOMING' ? 'Encaissement' : 'Décaissement'}</td>
          </tr>
          <tr>
            <td>Tiers</td>
            <td>{payment.customer?.name ?? payment.supplier?.name}</td>
          </tr>
          <tr>
            <td>Date</td>
            <td>{payment.paymentDate.slice(0, 10)}</td>
          </tr>
          <tr>
            <td>Montant</td>
            <td>{fmt(Number(payment.amount))}</td>
          </tr>
          <tr>
            <td>Mode</td>
            <td>{payment.method}</td>
          </tr>
          {payment.reference && (
            <tr>
              <td>Référence</td>
              <td>{payment.reference}</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Factures affectées</h2>
      {payment.allocations.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune affectation.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Facture</th>
              <th align="right">Montant affecté</th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={`/accounting/invoices/${a.invoice.id}`}>{a.invoice.invoiceNumber}</a>
                </td>
                <td align="right">{fmt(Number(a.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isCancelled && (
        <div style={{ marginTop: '1rem' }}>
          <button type="button" onClick={handleCancel} disabled={isProcessing}>
            Annuler ce paiement
          </button>
        </div>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/payments">Retour à la liste des paiements</a>
      </p>
    </main>
  );
}
