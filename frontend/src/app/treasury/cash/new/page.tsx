'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
  accountClass?: { code: string };
}

export default function NewCashAccountPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) =>
        setAccounts(data.filter((a: AccountOption) => a.isPostable && a.accountClass?.code === '5')),
      );
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/cash-accounts`, { code, name, accountId, description: description || undefined });
      router.push(`/treasury/cash/${data.id}`);
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
      <main style={{ maxWidth: 600, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 600, margin: '4rem auto' }}>
      <h1>Nouvelle caisse</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="code">Code</label>
          <br />
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="name">Nom</label>
          <br />
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="accountId">Compte comptable (classe 5 — trésorerie)</label>
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
          <label htmlFor="description">Description</label>
          <br />
          <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Création…' : 'Créer la caisse'}
        </button>
      </form>

      <p>
        <a href="/treasury/cash">Annuler</a>
      </p>
    </main>
  );
}
