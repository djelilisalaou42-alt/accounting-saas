'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface CustomerDetail {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  paymentTermDays: number;
  account: { code: string; label: string } | null;
}

interface Balance {
  totalDebit: number;
  totalCredit: number;
  balance: number;
  side: 'DEBIT' | 'CREDIT';
}

interface History {
  invoices: Array<{ id: string; invoiceNumber: string; issueDate: string; status: string; total: string; amountPaid: string }>;
  payments: Array<{ id: string; paymentNumber: string; paymentDate: string; amount: string }>;
  letterings: Array<{ id: string; code: string; is_balanced: boolean }>;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/customers/${params.id}`).then(({ data }) => setCustomer(data)).catch(() => setError('Client introuvable.'));
      apiClient.get(`/companies/${currentCompanyId}/customers/${params.id}/balance`).then(({ data }) => setBalance(data));
      apiClient.get(`/companies/${currentCompanyId}/customers/${params.id}/history`).then(({ data }) => setHistory(data));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  async function toggleActive() {
    if (!customer) return;
    await apiClient.post(`/companies/${currentCompanyId}/customers/${params.id}/${customer.isActive ? 'disable' : 'enable'}`);
    setCustomer({ ...customer, isActive: !customer.isActive });
  }

  if (error) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/customers">Retour</a>
      </main>
    );
  }
  if (!customer) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        {customer.code} — {customer.name}
      </h1>
      <p>{customer.isActive ? 'Actif' : 'Inactif'}</p>

      <table>
        <tbody>
          <tr>
            <td>Email</td>
            <td>{customer.email ?? '—'}</td>
          </tr>
          <tr>
            <td>Téléphone</td>
            <td>{customer.phone ?? '—'}</td>
          </tr>
          <tr>
            <td>Compte comptable</td>
            <td>{customer.account ? `${customer.account.code} — ${customer.account.label}` : '—'}</td>
          </tr>
          <tr>
            <td>Délai de paiement</td>
            <td>{customer.paymentTermDays} jours</td>
          </tr>
        </tbody>
      </table>

      {balance && (
        <p>
          Solde : <strong>{fmt(balance.balance)}</strong> ({balance.side === 'DEBIT' ? 'débiteur' : 'créditeur'})
        </p>
      )}

      <div style={{ marginTop: '1rem' }}>
        <a href={`/customers/${customer.id}/edit`}>
          <button type="button">Modifier</button>
        </a>{' '}
        <button type="button" onClick={toggleActive}>
          {customer.isActive ? 'Désactiver' : 'Réactiver'}
        </button>
      </div>

      {history && (
        <>
          <h2 style={{ marginTop: '1.5rem' }}>Factures</h2>
          {history.invoices.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune facture.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">N°</th>
                  <th align="left">Date</th>
                  <th align="left">Statut</th>
                  <th align="right">Total</th>
                  <th align="right">Payé</th>
                </tr>
              </thead>
              <tbody>
                {history.invoices.map((inv) => (
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/invoices/${inv.id}`)}>
                    <td>{inv.invoiceNumber}</td>
                    <td>{inv.issueDate.slice(0, 10)}</td>
                    <td>{inv.status}</td>
                    <td align="right">{fmt(Number(inv.total))}</td>
                    <td align="right">{fmt(Number(inv.amountPaid))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Paiements</h2>
          {history.payments.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucun paiement.</p>
          ) : (
            <ul>
              {history.payments.map((p) => (
                <li key={p.id}>
                  {p.paymentNumber} — {p.paymentDate.slice(0, 10)} — {fmt(Number(p.amount))}
                </li>
              ))}
            </ul>
          )}

          <h2>Lettrage</h2>
          {history.letterings.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucun lettrage.</p>
          ) : (
            <ul>
              {history.letterings.map((lt) => (
                <li key={lt.id}>
                  <a href={`/accounting/lettering/${lt.id}`}>{lt.code}</a> — {lt.is_balanced ? 'Clôturé' : 'En cours'}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/customers">Retour à la liste des clients</a>
      </p>
    </main>
  );
}
