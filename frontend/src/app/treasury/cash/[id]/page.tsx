'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface CashAccountDetail {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  description: string | null;
  account: { code: string; label: string };
}

interface Balance {
  balance: number;
  side: 'DEBIT' | 'CREDIT';
}

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CashAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [cash, setCash] = useState<CashAccountDetail | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [movType, setMovType] = useState<'RECEIPT' | 'DISBURSEMENT'>('RECEIPT');
  const [amount, setAmount] = useState('0');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [counterpartAccountId, setCounterpartAccountId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<CashAccountDetail>(`/companies/${currentCompanyId}/cash-accounts/${params.id}`);
      setCash(data);
      const { data: bal } = await apiClient.get(`/companies/${currentCompanyId}/cash-accounts/${params.id}/balance`);
      setBalance(bal);
    } catch {
      setError('Caisse introuvable.');
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

  async function toggleActive() {
    if (!cash) return;
    await apiClient.post(`/companies/${currentCompanyId}/cash-accounts/${params.id}/${cash.isActive ? 'disable' : 'enable'}`);
    load();
  }

  async function handleMovement(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/cash-accounts/${params.id}/movements`, {
        type: movType,
        amount: parseFloat(amount) || 0,
        transactionDate,
        label,
        counterpartAccountId,
      });
      setAmount('0');
      setLabel('');
      load();
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

  if (error && !cash) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/treasury/cash">Retour</a>
      </main>
    );
  }
  if (!cash) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>
        {cash.code} — {cash.name}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>Compte comptable : {cash.account.code} — {cash.account.label}</p>
      <p>Statut : {cash.isActive ? 'Active' : 'Inactive'}</p>
      {balance && (
        <p>
          Solde : <strong>{fmt(balance.balance)}</strong> ({balance.side === 'DEBIT' ? 'débiteur' : 'créditeur'})
        </p>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <button type="button" onClick={toggleActive}>
          {cash.isActive ? 'Désactiver' : 'Réactiver'}
        </button>{' '}
        <a href={`/treasury/cash/${cash.id}/movements`}>
          <button type="button">Voir l&apos;historique</button>
        </a>
      </div>

      <h2>Nouveau mouvement</h2>
      <form onSubmit={handleMovement}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="movType">Type</label>
            <br />
            <select id="movType" value={movType} onChange={(e) => setMovType(e.target.value as 'RECEIPT' | 'DISBURSEMENT')}>
              <option value="RECEIPT">Entrée</option>
              <option value="DISBURSEMENT">Sortie</option>
            </select>
          </div>
          <div>
            <label htmlFor="amount">Montant</label>
            <br />
            <input id="amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="transactionDate">Date</label>
            <br />
            <input id="transactionDate" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} required />
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="label">Libellé</label>
          <br />
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="counterpartAccountId">Compte de contrepartie</label>
          <br />
          <select id="counterpartAccountId" value={counterpartAccountId} onChange={(e) => setCounterpartAccountId(e.target.value)} required>
            <option value="">— choisir —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={isSaving}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer le mouvement'}
        </button>
      </form>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/treasury/cash">Retour à la liste des caisses</a>
      </p>
    </main>
  );
}
