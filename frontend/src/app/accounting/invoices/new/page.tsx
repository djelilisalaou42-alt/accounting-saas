'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface Party {
  id: string;
  code: string;
  name: string;
}

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  accountId: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NewInvoicePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [invoiceType, setInvoiceType] = useState<'SALE' | 'PURCHASE'>('SALE');
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [taxAccountId, setTaxAccountId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ description: '', quantity: '1', unitPrice: '0', taxRate: '18', accountId: '' }]);
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
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data.filter((a: AccountOption) => a.isPostable)));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: '', quantity: '1', unitPrice: '0', taxRate: '18', accountId: '' }]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const computed = lines.map((l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    const tax = parseFloat(l.taxRate) || 0;
    const subtotal = qty * price;
    return { subtotal, taxAmount: subtotal * (tax / 100) };
  });
  const totalHT = computed.reduce((s, c) => s + c.subtotal, 0);
  const totalTVA = computed.reduce((s, c) => s + c.taxAmount, 0);
  const totalTTC = totalHT + totalTVA;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/invoices`, {
        invoiceType,
        customerId: invoiceType === 'SALE' ? partyId : undefined,
        supplierId: invoiceType === 'PURCHASE' ? partyId : undefined,
        issueDate,
        dueDate,
        taxAccountId: taxAccountId || undefined,
        items: lines.map((l) => ({
          description: l.description,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          taxRate: parseFloat(l.taxRate) || 0,
          accountId: l.accountId,
        })),
      });
      router.push(`/accounting/invoices/${data.id}`);
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
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  const parties = invoiceType === 'SALE' ? customers : suppliers;

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Nouvelle facture</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="invoiceType">Type</label>
            <br />
            <select
              id="invoiceType"
              value={invoiceType}
              onChange={(e) => {
                setInvoiceType(e.target.value as 'SALE' | 'PURCHASE');
                setPartyId('');
              }}
            >
              <option value="SALE">Vente (client)</option>
              <option value="PURCHASE">Achat (fournisseur)</option>
            </select>
          </div>
          <div>
            <label htmlFor="partyId">{invoiceType === 'SALE' ? 'Client' : 'Fournisseur'}</label>
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
          <div>
            <label htmlFor="issueDate">Date</label>
            <br />
            <input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="dueDate">Échéance</label>
            <br />
            <input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="taxAccountId">Compte de TVA (si applicable)</label>
          <br />
          <select id="taxAccountId" value={taxAccountId} onChange={(e) => setTaxAccountId(e.target.value)}>
            <option value="">— aucun —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.label}
              </option>
            ))}
          </select>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Description</th>
              <th align="left">Compte</th>
              <th align="right">Qté</th>
              <th align="right">P.U.</th>
              <th align="right">TVA %</th>
              <th align="right">Total HT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} required />
                </td>
                <td>
                  <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })} required>
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="number" min="0.0001" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} style={{ width: 70, textAlign: 'right' }} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} style={{ width: 90, textAlign: 'right' }} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.taxRate} onChange={(e) => updateLine(index, { taxRate: e.target.value })} style={{ width: 60, textAlign: 'right' }} />
                </td>
                <td align="right">{fmt(computed[index].subtotal)}</td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)}>
                      Retirer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} align="right">
                <strong>Total HT</strong>
              </td>
              <td align="right">
                <strong>{fmt(totalHT)}</strong>
              </td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={5} align="right">
                TVA
              </td>
              <td align="right">{fmt(totalTVA)}</td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={5} align="right">
                <strong>Total TTC</strong>
              </td>
              <td align="right">
                <strong>{fmt(totalTTC)}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <button type="button" onClick={addLine}>
          + Ajouter une ligne
        </button>

        <div style={{ marginTop: '1.5rem' }}>
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Création…' : 'Créer la facture (brouillon)'}
          </button>
        </div>
      </form>

      <p>
        <a href="/accounting/invoices">Annuler</a>
      </p>
    </main>
  );
}
