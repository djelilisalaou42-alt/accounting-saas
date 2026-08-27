'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface BankAccountDetail {
  id: string;
  code: string;
  name: string;
  bankName: string;
  accountNumber: string | null;
  isActive: boolean;
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

export default function BankAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [bank, setBank] = useState<BankAccountDetail | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [movType, setMovType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('0');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [counterpartAccountId, setCounterpartAccountId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<BankAccountDetail>(`/companies/${currentCompanyId}/bank-accounts/${params.id}`);
      setBank(data);
      const { data: bal } = await apiClient.get(`/companies/${currentCompanyId}/bank-accounts/${params.id}/balance`);
      setBalance(bal);
    } catch {
      setError('Compte bancaire introuvable.');
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
    if (!bank) return;
    await apiClient.post(`/companies/${currentCompanyId}/bank-accounts/${params.id}/${bank.isActive ? 'disable' : 'enable'}`);
    load();
  }

  async function handleMovement(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/bank-accounts/${params.id}/movements`, {
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

  if (error && !bank) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/treasury/banks">Retour</a>
      </main>
    );
  }
  if (!bank) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>
        {bank.code} — {bank.name}
      </h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>Banque : {bank.bankName}</p>
      {bank.accountNumber && <p>N° de compte : {bank.accountNumber}</p>}
      <p>Compte comptable : {bank.account.code} — {bank.account.label}</p>
      <p>Statut : {bank.isActive ? 'Actif' : 'Inactif'}</p>
      {balance && (
        <p>
          Solde : <strong>{fmt(balance.balance)}</strong> ({balance.side === 'DEBIT' ? 'débiteur' : 'créditeur'})
        </p>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <button type="button" onClick={toggleActive}>
          {bank.isActive ? 'Désactiver' : 'Réactiver'}
        </button>{' '}
        <a href={`/treasury/banks/${bank.id}/movements`}>
          <button type="button">Historique</button>
        </a>{' '}
        <a href={`/treasury/reconciliation?bankAccountId=${bank.id}`}>
          <button type="button">Rapprochement bancaire</button>
        </a>
      </div>

      <h2>Nouveau mouvement</h2>
      <form onSubmit={handleMovement}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="movType">Type</label>
            <br />
            <select id="movType" value={movType} onChange={(e) => setMovType(e.target.value as 'CREDIT' | 'DEBIT')}>
              <option value="CREDIT">Encaissement</option>
              <option value="DEBIT">Décaissement / frais</option>
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
        <a href="/treasury/banks">Retour à la liste des comptes bancaires</a>
      </p>
    </main>
  );
}
