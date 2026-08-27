'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface Party {
  id: string;
  code: string;
  name: string;
}

interface TreasuryAccount {
  id: string;
  name?: string;
  bankName?: string;
  accountNumber?: string;
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  total: string;
  amountPaid: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NewPaymentForm() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedInvoiceId = searchParams.get('invoiceId');

  const [direction, setDirection] = useState<'INCOMING' | 'OUTGOING'>('INCOMING');
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [cashAccounts, setCashAccounts] = useState<TreasuryAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<TreasuryAccount[]>([]);
  const [partyId, setPartyId] = useState('');
  const [treasuryType, setTreasuryType] = useState<'CASH' | 'BANK'>('BANK');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('0');
  const [reference, setReference] = useState('');
  const [openInvoices, setOpenInvoices] = useState<InvoiceOption[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/customers`, { params: { isActive: 'true' } }).then(({ data }) => setCustomers(data.customers));
      apiClient.get(`/companies/${currentCompanyId}/suppliers`, { params: { isActive: 'true' } }).then(({ data }) => setSuppliers(data.suppliers));
      apiClient.get(`/companies/${currentCompanyId}/payments/treasury-accounts`).then(({ data }) => {
        setCashAccounts(data.cashAccounts);
        setBankAccounts(data.bankAccounts);
      });
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  useEffect(() => {
    if (!partyId || !currentCompanyId) {
      setOpenInvoices([]);
      return;
    }
    const params = direction === 'INCOMING' ? { customerId: partyId } : { supplierId: partyId };
    apiClient.get(`/companies/${currentCompanyId}/invoices`, { params }).then(({ data }) => {
      const open = data.invoices.filter((inv: any) => inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID');
      setOpenInvoices(open);
      if (preselectedInvoiceId && open.some((inv: InvoiceOption) => inv.id === preselectedInvoiceId)) {
        const inv = open.find((i: InvoiceOption) => i.id === preselectedInvoiceId)!;
        setAllocations({ [preselectedInvoiceId]: String(Number(inv.total) - Number(inv.amountPaid)) });
      }
    });
  }, [partyId, direction, currentCompanyId, preselectedInvoiceId]);

  function toggleAllocation(invoiceId: string, remaining: number, checked: boolean) {
    setAllocations((prev) => {
      const next = { ...prev };
      if (checked) next[invoiceId] = String(remaining);
      else delete next[invoiceId];
      return next;
    });
  }

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/payments`, {
        direction,
        method,
        customerId: direction === 'INCOMING' ? partyId : undefined,
        supplierId: direction === 'OUTGOING' ? partyId : undefined,
        paymentDate,
        amount: parseFloat(amount) || 0,
        reference: reference || undefined,
        cashAccountId: treasuryType === 'CASH' ? treasuryAccountId : undefined,
        bankAccountId: treasuryType === 'BANK' ? treasuryAccountId : undefined,
        allocations: Object.entries(allocations).map(([invoiceId, amt]) => ({ invoiceId, amount: parseFloat(amt) || 0 })),
      });
      router.push('/accounting/payments');
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  const parties = direction === 'INCOMING' ? customers : suppliers;

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Nouveau paiement</h1>
      {error && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="direction">Sens</label>
            <br />
            <select
              id="direction"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as 'INCOMING' | 'OUTGOING');
                setPartyId('');
                setAllocations({});
              }}
            >
              <option value="INCOMING">Encaissement (client)</option>
              <option value="OUTGOING">Décaissement (fournisseur)</option>
            </select>
          </div>
          <div>
            <label htmlFor="partyId">{direction === 'INCOMING' ? 'Client' : 'Fournisseur'}</label>
            <br />
            <select id="partyId" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
              <option value="">— choisir —</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="paymentDate">Date</label>
            <br />
            <input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="amount">Montant</label>
            <br />
            <input id="amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="method">Mode</label>
            <br />
            <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Espèces</option>
              <option value="BANK_TRANSFER">Virement</option>
              <option value="CHECK">Chèque</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="CARD">Carte</option>
              <option value="OTHER">Autre</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Compte de trésorerie</label>
          <br />
          <select value={treasuryType} onChange={(e) => setTreasuryType(e.target.value as 'CASH' | 'BANK')} style={{ marginRight: '0.5rem' }}>
            <option value="BANK">Banque</option>
            <option value="CASH">Caisse</option>
          </select>
          <select value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)} required>
            <option value="">— choisir —</option>
            {(treasuryType === 'CASH' ? cashAccounts : bankAccounts).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? `${a.bankName} — ${a.accountNumber}`}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="reference">Référence</label>
          <br />
          <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>

        {partyId && (
          <>
            <h2>Affectation aux factures</h2>
            {openInvoices.length === 0 ? (
              <p style={{ fontStyle: 'italic' }}>Aucune facture ouverte pour ce tiers.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th></th>
                    <th align="left">Facture</th>
                    <th align="right">Solde restant</th>
                    <th align="right">Montant affecté</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => {
                    const remaining = Number(inv.total) - Number(inv.amountPaid);
                    const checked = inv.id in allocations;
                    return (
                      <tr key={inv.id}>
                        <td>
                          <input type="checkbox" checked={checked} onChange={(e) => toggleAllocation(inv.id, remaining, e.target.checked)} />
                        </td>
                        <td>{inv.invoiceNumber}</td>
                        <td align="right">{fmt(remaining)}</td>
                        <td align="right">
                          {checked && (
                            <input
                              type="number"
                              min="0.01"
                              max={remaining}
                              step="0.01"
                              value={allocations[inv.id]}
                              onChange={(e) => setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                              style={{ width: 100, textAlign: 'right' }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p>
              Total affecté : {fmt(totalAllocated)} / Montant du paiement : {fmt(parseFloat(amount) || 0)}
            </p>
          </>
        )}

        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer le paiement'}
        </button>
      </form>

      <p>
        <a href="/accounting/payments">Annuler</a>
      </p>
    </main>
  );
}

export default function NewPaymentPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>}>
      <NewPaymentForm />
    </Suspense>
  );
}
