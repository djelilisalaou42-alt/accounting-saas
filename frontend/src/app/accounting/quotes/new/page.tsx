'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface Customer {
  id: string;
  code: string;
  name: string;
}

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NewQuotePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ description: '', quantity: '1', unitPrice: '0', taxRate: '18' }]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/customers`, { params: { isActive: 'true' } }).then(({ data }) => setCustomers(data.customers));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: '', quantity: '1', unitPrice: '0', taxRate: '18' }]);
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
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/quotes`, {
        customerId,
        issueDate,
        expiryDate: expiryDate || undefined,
        items: lines.map((l) => ({
          description: l.description,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          taxRate: parseFloat(l.taxRate) || 0,
        })),
      });
      router.push(`/accounting/quotes/${data.id}`);
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

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Nouveau devis</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="customerId">Client</label>
            <br />
            <select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">— choisir —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
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
            <label htmlFor="expiryDate">Date d&apos;expiration</label>
            <br />
            <input id="expiryDate" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Description</th>
              <th align="right">Quantité</th>
              <th align="right">Prix unitaire</th>
              <th align="right">TVA %</th>
              <th align="right">Total HT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} required style={{ width: '100%' }} />
                </td>
                <td>
                  <input type="number" min="0.0001" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} style={{ width: 80, textAlign: 'right' }} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} style={{ width: 100, textAlign: 'right' }} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.taxRate} onChange={(e) => updateLine(index, { taxRate: e.target.value })} style={{ width: 70, textAlign: 'right' }} />
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
              <td colSpan={4} align="right">
                <strong>Total HT</strong>
              </td>
              <td align="right">
                <strong>{fmt(totalHT)}</strong>
              </td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={4} align="right">
                TVA
              </td>
              <td align="right">{fmt(totalTVA)}</td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={4} align="right">
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
            {isSaving ? 'Création…' : 'Créer le devis'}
          </button>
        </div>
      </form>

      <p>
        <a href="/accounting/quotes">Annuler</a>
      </p>
    </main>
  );
}
