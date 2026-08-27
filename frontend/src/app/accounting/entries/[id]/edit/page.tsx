'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
  isActive: boolean;
}

interface LineDraft {
  accountId: string;
  accountDisplay: string;
  label: string;
  debit: string;
  credit: string;
}

export default function EditAccountingEntryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [entryDate, setEntryDate] = useState('');
  const [reference, setReference] = useState('');
  const [label, setLabel] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notEditable, setNotEditable] = useState(false);
  const [focusedLineIndex, setFocusedLineIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!isAuthenticated || !currentCompanyId) return;

    apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data.filter((a: AccountOption) => a.isActive && a.isPostable)));

    apiClient.get(`/companies/${currentCompanyId}/accounting-entries/${params.id}`).then(({ data }) => {
      if (data.status !== 'DRAFT') {
        setNotEditable(true);
        return;
      }
      setEntryDate(data.entryDate.slice(0, 10));
      setReference(data.reference ?? '');
      setLabel(data.label);
      setLines(
        data.lines.map((l: any) => ({
          accountId: l.account.id ?? '',
          accountDisplay: `${l.account.code} — ${l.account.label}`,
          label: l.label ?? '',
          debit: l.side === 'DEBIT' ? String(l.amount) : '',
          credit: l.side === 'CREDIT' ? String(l.amount) : '',
        })),
      );
    });
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { accountId: '', accountDisplay: '', label: '', debit: '', credit: '' }]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }
  function matchingAccounts(query: string): AccountOption[] {
    if (!query) return [];
    const q = query.toLowerCase();
    return accounts.filter((a) => a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)).slice(0, 8);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.patch(`/companies/${currentCompanyId}/accounting-entries/${params.id}`, {
        entryDate,
        reference: reference || undefined,
        label,
        lines: lines
          .filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
          .map((l) => ({ accountId: l.accountId, label: l.label || undefined, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
      });
      router.push(`/accounting/entries/${params.id}`);
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

  if (notEditable) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <h1>Modification impossible</h1>
        <p>Seule une écriture en brouillon peut être modifiée.</p>
        <a href={`/accounting/entries/${params.id}`}>Retour à l&apos;écriture</a>
      </main>
    );
  }

  if (!label && lines.length === 0) {
    return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Modifier le brouillon</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="entryDate">Date</label>
            <br />
            <input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="reference">Référence</label>
            <br />
            <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="label">Libellé</label>
          <br />
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required style={{ width: '100%' }} />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Compte</th>
              <th align="left">Libellé</th>
              <th align="right">Débit</th>
              <th align="right">Crédit</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td style={{ position: 'relative' }}>
                  <input
                    value={line.accountDisplay}
                    onChange={(e) => {
                      updateLine(index, { accountDisplay: e.target.value, accountId: '' });
                      setFocusedLineIndex(index);
                    }}
                    onFocus={() => setFocusedLineIndex(index)}
                    onBlur={() => setTimeout(() => setFocusedLineIndex(null), 150)}
                  />
                  {focusedLineIndex === index && matchingAccounts(line.accountDisplay).length > 0 && (
                    <ul style={{ position: 'absolute', background: 'white', border: '1px solid #ccc', listStyle: 'none', margin: 0, padding: 0, zIndex: 10, minWidth: 260 }}>
                      {matchingAccounts(line.accountDisplay).map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => updateLine(index, { accountId: a.id, accountDisplay: `${a.code} — ${a.label}` })}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.25rem 0.5rem' }}
                          >
                            {a.code} — {a.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <input value={line.label} onChange={(e) => updateLine(index, { label: e.target.value })} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.debit} onChange={(e) => updateLine(index, { debit: e.target.value, credit: '' })} style={{ textAlign: 'right', width: 120 }} />
                </td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.credit} onChange={(e) => updateLine(index, { credit: e.target.value, debit: '' })} style={{ textAlign: 'right', width: 120 }} />
                </td>
                <td>
                  {lines.length > 2 && (
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
              <td colSpan={2} align="right">
                <strong>TOTAUX</strong>
              </td>
              <td align="right">
                <strong>{totalDebit.toLocaleString('fr-FR')}</strong>
              </td>
              <td align="right">
                <strong>{totalCredit.toLocaleString('fr-FR')}</strong>
              </td>
              <td></td>
            </tr>
            <tr>
              <td colSpan={2} align="right">
                DIFFÉRENCE
              </td>
              <td colSpan={2} align="right" style={{ color: difference === 0 ? 'green' : 'red' }}>
                {difference.toLocaleString('fr-FR')}
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
            {isSaving ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
        </div>
      </form>

      <p>
        <a href={`/accounting/entries/${params.id}`}>Annuler</a>
      </p>
    </main>
  );
}
