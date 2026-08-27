'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
  accountClass?: { code: string };
}

export default function NewSupplierPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paymentTermDays, setPaymentTermDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) =>
        setAccounts(data.filter((a: AccountOption) => a.isPostable && a.accountClass?.code === '4')),
      );
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/suppliers`, {
        code,
        name,
        email: email || undefined,
        phone: phone || undefined,
        accountId,
        paymentTermDays,
      });
      router.push(`/suppliers/${data.id}`);
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
      <h1>Nouveau fournisseur</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="code">Code</label>
          <br />
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="name">Nom / Raison sociale</label>
          <br />
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <br />
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="phone">Téléphone</label>
          <br />
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="accountId">Compte comptable (comptes de tiers, classe 4)</label>
          <br />
          <select id="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">— choisir —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.label}
              </option>
            ))}
          </select>
          {accounts.length === 0 && (
            <p style={{ fontSize: '0.85em', color: '#a15c00' }}>
              Aucun compte de tiers trouvé — créez-en un dans le plan comptable avant de créer un fournisseur.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="paymentTermDays">Délai de paiement (jours)</label>
          <br />
          <input id="paymentTermDays" type="number" min={0} max={365} value={paymentTermDays} onChange={(e) => setPaymentTermDays(Number(e.target.value))} />
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Création…' : 'Créer le fournisseur'}
        </button>
      </form>

      <p>
        <a href="/suppliers">Annuler</a>
      </p>
    </main>
  );
}
