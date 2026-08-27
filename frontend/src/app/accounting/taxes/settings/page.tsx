'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface TaxOption {
  id: string;
  code: string;
  label: string;
  rate: string;
}
interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}
interface SettingsRow {
  id: string;
  isActive: boolean;
  tax: { code: string; label: string };
  collectedAccount: { code: string; label: string } | null;
  deductibleAccount: { code: string; label: string } | null;
  payableAccount: { code: string; label: string } | null;
}

export default function TaxSettingsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsRow[] | null>(null);
  const [taxes, setTaxes] = useState<TaxOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [taxId, setTaxId] = useState('');
  const [collectedAccountId, setCollectedAccountId] = useState('');
  const [deductibleAccountId, setDeductibleAccountId] = useState('');
  const [payableAccountId, setPayableAccountId] = useState('');

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/tax-settings`);
      setSettings(data);
    } catch {
      setError('Impossible de charger la configuration fiscale (permission TAX.READ requise).');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      load();
      apiClient.get('/taxes').then(({ data }) => setTaxes(data));
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data.filter((a: AccountOption) => a.isPostable)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/tax-settings`, {
        taxId,
        collectedAccountId: collectedAccountId || undefined,
        deductibleAccountId: deductibleAccountId || undefined,
        payableAccountId: payableAccountId || undefined,
      });
      setTaxId('');
      setCollectedAccountId('');
      setDeductibleAccountId('');
      setPayableAccountId('');
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

  async function toggle(s: SettingsRow) {
    await apiClient.post(`/companies/${currentCompanyId}/tax-settings/${s.id}/${s.isActive ? 'disable' : 'enable'}`);
    load();
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
      <h1>Configuration fiscale</h1>
      <p style={{ fontStyle: 'italic', color: '#666' }}>
        Associez à chaque taxe du référentiel les comptes réels de votre plan comptable — jamais de
        numéro codé en dur.
      </p>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {settings === null ? (
        <p>Chargement…</p>
      ) : settings.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune configuration fiscale.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
          <thead>
            <tr>
              <th align="left">Taxe</th>
              <th align="left">Compte collecté</th>
              <th align="left">Compte déductible</th>
              <th align="left">Compte à décaisser/crédit</th>
              <th align="left">Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => (
              <tr key={s.id}>
                <td>{s.tax.code} — {s.tax.label}</td>
                <td>{s.collectedAccount ? s.collectedAccount.code : '—'}</td>
                <td>{s.deductibleAccount ? s.deductibleAccount.code : '—'}</td>
                <td>{s.payableAccount ? s.payableAccount.code : '—'}</td>
                <td>{s.isActive ? 'Active' : 'Inactive'}</td>
                <td>
                  <button type="button" onClick={() => toggle(s)}>
                    {s.isActive ? 'Désactiver' : 'Réactiver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Configurer une taxe</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="taxId">Taxe</label>
          <br />
          <select id="taxId" value={taxId} onChange={(e) => setTaxId(e.target.value)} required>
            <option value="">— choisir —</option>
            {taxes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.label} ({Number(t.rate).toFixed(2)}%)
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="collectedAccountId">Compte de TVA collectée</label>
            <br />
            <select id="collectedAccountId" value={collectedAccountId} onChange={(e) => setCollectedAccountId(e.target.value)}>
              <option value="">— aucun —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="deductibleAccountId">Compte de TVA déductible</label>
            <br />
            <select id="deductibleAccountId" value={deductibleAccountId} onChange={(e) => setDeductibleAccountId(e.target.value)}>
              <option value="">— aucun —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="payableAccountId">Compte de TVA à décaisser / crédit</label>
            <br />
            <select id="payableAccountId" value={payableAccountId} onChange={(e) => setPayableAccountId(e.target.value)}>
              <option value="">— aucun —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer la configuration'}
        </button>
      </form>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/taxes">Retour aux taxes</a>
      </p>
    </main>
  );
}
