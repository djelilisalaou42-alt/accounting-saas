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
}
interface CategoryRow {
  id: string;
  code: string;
  name: string;
  defaultMethod: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
  defaultUsefulLifeYears: number;
  isActive: boolean;
  assetAccount: { code: string; label: string };
  depreciationAccount: { code: string; label: string };
  depreciationExpenseAccount: { code: string; label: string };
}

export default function AssetCategoriesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [depreciationAccountId, setDepreciationAccountId] = useState('');
  const [depreciationExpenseAccountId, setDepreciationExpenseAccountId] = useState('');
  const [defaultMethod, setDefaultMethod] = useState<'STRAIGHT_LINE' | 'DECLINING_BALANCE'>('STRAIGHT_LINE');
  const [defaultUsefulLifeYears, setDefaultUsefulLifeYears] = useState(5);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/asset-categories`);
      setCategories(data);
    } catch {
      setError('Impossible de charger les catégories (permission ASSET.READ requise).');
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
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/asset-categories`, {
        code,
        name,
        assetAccountId,
        depreciationAccountId,
        depreciationExpenseAccountId,
        defaultMethod,
        defaultUsefulLifeYears,
      });
      setCode('');
      setName('');
      setAssetAccountId('');
      setDepreciationAccountId('');
      setDepreciationExpenseAccountId('');
      setDefaultUsefulLifeYears(5);
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

  async function toggle(cat: CategoryRow) {
    await apiClient.post(`/companies/${currentCompanyId}/asset-categories/${cat.id}/${cat.isActive ? 'disable' : 'enable'}`);
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
      <h1>Catégories d&apos;immobilisations</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {categories === null ? (
        <p>Chargement…</p>
      ) : categories.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune catégorie.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Nom</th>
              <th align="left">Compte immo.</th>
              <th align="left">Compte amort.</th>
              <th align="left">Compte dotation</th>
              <th align="left">Méthode</th>
              <th align="right">Durée</th>
              <th align="left">Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>{c.assetAccount.code}</td>
                <td>{c.depreciationAccount.code}</td>
                <td>{c.depreciationExpenseAccount.code}</td>
                <td>{c.defaultMethod === 'STRAIGHT_LINE' ? 'Linéaire' : 'Dégressif'}</td>
                <td align="right">{c.defaultUsefulLifeYears} ans</td>
                <td>{c.isActive ? 'Active' : 'Inactive'}</td>
                <td>
                  <button type="button" onClick={() => toggle(c)}>
                    {c.isActive ? 'Désactiver' : 'Réactiver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Nouvelle catégorie</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div>
            <label htmlFor="code">Code</label>
            <br />
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="name">Nom</label>
            <br />
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="assetAccountId">Compte d&apos;immobilisation (classe 2)</label>
            <br />
            <select id="assetAccountId" value={assetAccountId} onChange={(e) => setAssetAccountId(e.target.value)} required>
              <option value="">— choisir —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="depreciationAccountId">Compte d&apos;amortissement (classe 28)</label>
            <br />
            <select id="depreciationAccountId" value={depreciationAccountId} onChange={(e) => setDepreciationAccountId(e.target.value)} required>
              <option value="">— choisir —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="depreciationExpenseAccountId">Compte de dotation (classe 68)</label>
            <br />
            <select id="depreciationExpenseAccountId" value={depreciationExpenseAccountId} onChange={(e) => setDepreciationExpenseAccountId(e.target.value)} required>
              <option value="">— choisir —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="defaultMethod">Méthode par défaut</label>
            <br />
            <select id="defaultMethod" value={defaultMethod} onChange={(e) => setDefaultMethod(e.target.value as 'STRAIGHT_LINE' | 'DECLINING_BALANCE')}>
              <option value="STRAIGHT_LINE">Linéaire</option>
              <option value="DECLINING_BALANCE">Dégressif</option>
            </select>
          </div>
          <div>
            <label htmlFor="defaultUsefulLifeYears">Durée par défaut (années)</label>
            <br />
            <input id="defaultUsefulLifeYears" type="number" min={1} value={defaultUsefulLifeYears} onChange={(e) => setDefaultUsefulLifeYears(Number(e.target.value))} required />
          </div>
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Création…' : 'Créer la catégorie'}
        </button>
      </form>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/assets">Retour aux immobilisations</a>
      </p>
    </main>
  );
}
