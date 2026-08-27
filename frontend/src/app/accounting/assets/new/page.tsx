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
interface CategoryOption {
  id: string;
  code: string;
  name: string;
  defaultMethod: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
  defaultUsefulLifeYears: number;
}
interface SupplierOption {
  id: string;
  code: string;
  name: string;
}
interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  total: string;
}

export default function NewFixedAssetPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [counterpartAccountId, setCounterpartAccountId] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [acquisitionCost, setAcquisitionCost] = useState('0');
  const [residualValue, setResidualValue] = useState('0');
  const [usefulLifeYears, setUsefulLifeYears] = useState(5);
  const [depreciationMethod, setDepreciationMethod] = useState<'STRAIGHT_LINE' | 'DECLINING_BALANCE'>('STRAIGHT_LINE');
  const [location, setLocation] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/accounts`).then(({ data }) => setAccounts(data.filter((a: AccountOption) => a.isPostable)));
      apiClient.get(`/companies/${currentCompanyId}/asset-categories`).then(({ data }) => setCategories(data));
      apiClient.get(`/companies/${currentCompanyId}/suppliers`).then(({ data }) => setSuppliers(data.suppliers ?? data));
      apiClient
        .get(`/companies/${currentCompanyId}/invoices`, { params: { invoiceType: 'PURCHASE' } })
        .then(({ data }) => setInvoices(data.invoices ?? data))
        .catch(() => setInvoices([]));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  function handleCategoryChange(id: string) {
    setCategoryId(id);
    const cat = categories.find((c) => c.id === id);
    if (cat) {
      setDepreciationMethod(cat.defaultMethod);
      setUsefulLifeYears(cat.defaultUsefulLifeYears);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/fixed-assets`, {
        code,
        label,
        categoryId: categoryId || undefined,
        assetAccountId: assetAccountId || undefined,
        supplierId: supplierId || undefined,
        invoiceId: invoiceId || undefined,
        counterpartAccountId: invoiceId ? undefined : counterpartAccountId || undefined,
        acquisitionDate,
        acquisitionCost: parseFloat(acquisitionCost) || 0,
        residualValue: parseFloat(residualValue) || 0,
        usefulLifeYears,
        depreciationMethod,
        location: location || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      router.push(`/accounting/assets/${data.id}`);
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
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Nouvelle immobilisation</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="code">Code</label>
          <br />
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="label">Libellé</label>
          <br />
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="categoryId">Catégorie (facultatif — hérite comptes/méthode/durée par défaut)</label>
          <br />
          <select id="categoryId" value={categoryId} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">— aucune —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="assetAccountId">Compte d&apos;immobilisation {categoryId ? '(facultatif si catégorie choisie)' : ''}</label>
          <br />
          <select id="assetAccountId" value={assetAccountId} onChange={(e) => setAssetAccountId(e.target.value)} required={!categoryId}>
            <option value="">— choisir —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="supplierId">Fournisseur (facultatif)</label>
          <br />
          <select id="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— aucun —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invoiceId">Facture d&apos;achat liée (facultatif — évite une double comptabilisation)</label>
          <br />
          <select id="invoiceId" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">— aucune —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNumber} ({inv.total})
              </option>
            ))}
          </select>
        </div>
        {!invoiceId && (
          <div>
            <label htmlFor="counterpartAccountId">Compte de contrepartie (requis sans facture liée — génère l&apos;écriture d&apos;acquisition)</label>
            <br />
            <select id="counterpartAccountId" value={counterpartAccountId} onChange={(e) => setCounterpartAccountId(e.target.value)} required={!invoiceId}>
              <option value="">— choisir —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="acquisitionDate">Date d&apos;acquisition</label>
            <br />
            <input id="acquisitionDate" type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="acquisitionCost">Coût d&apos;acquisition</label>
            <br />
            <input id="acquisitionCost" type="number" min="0.01" step="0.01" value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="residualValue">Valeur résiduelle</label>
            <br />
            <input id="residualValue" type="number" min="0" step="0.01" value={residualValue} onChange={(e) => setResidualValue(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="usefulLifeYears">Durée d&apos;utilité (années)</label>
            <br />
            <input id="usefulLifeYears" type="number" min={1} value={usefulLifeYears} onChange={(e) => setUsefulLifeYears(Number(e.target.value))} required />
          </div>
          <div>
            <label htmlFor="depreciationMethod">Méthode d&apos;amortissement</label>
            <br />
            <select id="depreciationMethod" value={depreciationMethod} onChange={(e) => setDepreciationMethod(e.target.value as 'STRAIGHT_LINE' | 'DECLINING_BALANCE')}>
              <option value="STRAIGHT_LINE">Linéaire</option>
              <option value="DECLINING_BALANCE">Dégressif</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <label htmlFor="location">Localisation</label>
          <br />
          <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="reference">Référence</label>
          <br />
          <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="notes">Notes</label>
          <br />
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: '100%' }} />
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Création…' : "Créer l'immobilisation"}
        </button>
      </form>

      <p>
        <a href="/accounting/assets">Annuler</a>
      </p>
    </main>
  );
}
