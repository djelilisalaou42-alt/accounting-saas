'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';
import { AttachmentsPanel } from '../../../../components/shared/AttachmentsPanel';

interface BudgetLineRow {
  id: string;
  accountId: string;
  month: number;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
  consumptionRate: number | null;
  account: { code: string; label: string };
}
interface BudgetDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  period: { name: string };
  lines: BudgetLineRow[];
  summary: { totalPlanned: number; totalActual: number; totalVariance: number; consumptionRate: number | null };
}
interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Brouillon', ACTIVE: 'Actif', CLOSED: 'Clôturé' };
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [budget, setBudget] = useState<BudgetDetail | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [accountId, setAccountId] = useState('');
  const [month, setMonth] = useState(1);
  const [plannedAmount, setPlannedAmount] = useState('0');

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<BudgetDetail>(`/companies/${currentCompanyId}/budgets/${params.id}`);
      setBudget(data);
    } catch {
      setError('Budget introuvable.');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      load();
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data.filter((a: AccountOption) => a.isPostable)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, params.id]);

  async function runAction(path: string) {
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/budgets/${params.id}/${path}`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setActionError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setActionError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddLine(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/budgets/${params.id}/lines`, {
        accountId,
        month,
        plannedAmount: parseFloat(plannedAmount) || 0,
      });
      setAccountId('');
      setPlannedAmount('0');
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setActionError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setActionError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !budget) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/budgets">Retour</a>
      </main>
    );
  }
  if (!budget) return <main style={{ maxWidth: 900, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>{budget.name}</h1>
      {actionError && <p role="alert" style={{ color: 'red' }}>{actionError}</p>}

      <p>Exercice : {budget.period.name} — Statut : <strong>{STATUS_LABELS[budget.status] ?? budget.status}</strong></p>
      {budget.description && <p>{budget.description}</p>}

      <div style={{ margin: '1rem 0' }}>
        <a href={`/accounting/budgets/${budget.id}/edit`}>
          <button type="button" disabled={budget.status !== 'DRAFT'}>Modifier</button>
        </a>{' '}
        {budget.status === 'DRAFT' && (
          <button type="button" onClick={() => runAction('activate')} disabled={isSaving}>
            Activer
          </button>
        )}
        {budget.status === 'ACTIVE' && (
          <button type="button" onClick={() => runAction('close')} disabled={isSaving}>
            Clôturer
          </button>
        )}
      </div>

      <h2>Analyse budget vs réalisé</h2>
      <p style={{ fontStyle: 'italic', color: '#666' }}>
        Le réalisé est calculé automatiquement depuis vos écritures comptables validées — jamais
        saisi manuellement.
      </p>
      {budget.lines.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune ligne budgétaire.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
          <thead>
            <tr>
              <th align="left">Compte</th>
              <th align="left">Mois</th>
              <th align="right">Budgété</th>
              <th align="right">Réalisé</th>
              <th align="right">Écart</th>
              <th align="right">Taux</th>
            </tr>
          </thead>
          <tbody>
            {budget.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.account.code} — {l.account.label}</td>
                <td>{MONTH_LABELS[l.month - 1]}</td>
                <td align="right">{fmt(l.plannedAmount)}</td>
                <td align="right">{fmt(l.actualAmount)}</td>
                <td align="right" style={{ color: l.variance > 0 ? 'red' : 'green' }}>{fmt(l.variance)}</td>
                <td align="right">{l.consumptionRate !== null ? `${l.consumptionRate}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan={2}>Total</td>
              <td align="right">{fmt(budget.summary.totalPlanned)}</td>
              <td align="right">{fmt(budget.summary.totalActual)}</td>
              <td align="right">{fmt(budget.summary.totalVariance)}</td>
              <td align="right">{budget.summary.consumptionRate !== null ? `${budget.summary.consumptionRate}%` : '—'}</td>
            </tr>
          </tfoot>
        </table>
      )}

      {budget.status === 'DRAFT' && (
        <>
          <h2>Ajouter une ligne budgétaire</h2>
          <form onSubmit={handleAddLine} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="accountId">Compte</label>
              <br />
              <select id="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">— choisir —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="month">Mois</label>
              <br />
              <select id="month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="plannedAmount">Montant budgété</label>
              <br />
              <input id="plannedAmount" type="number" step="0.01" value={plannedAmount} onChange={(e) => setPlannedAmount(e.target.value)} required />
            </div>
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Ajout…' : 'Ajouter'}
            </button>
          </form>
        </>
      )}

      <AttachmentsPanel companyId={currentCompanyId!} entityType="budget" entityId={budget.id} />

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/budgets">Retour aux budgets</a>
      </p>
    </main>
  );
}
