'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';
import { AttachmentsPanel } from '../../../../components/shared/AttachmentsPanel';

interface DepreciationEntryRow {
  id: string;
  fiscalYear: number;
  amount: string;
  accumulated: string;
  netBookValue: string;
}
interface AssetDisposal {
  disposalDate: string;
  disposalType: string;
  grossValue: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  disposalPrice: string;
  result: string;
}
interface FixedAssetDetail {
  id: string;
  code: string;
  label: string;
  status: 'ACQUIRED' | 'IN_SERVICE' | 'UNDER_MAINTENANCE' | 'DISPOSED' | 'FULLY_DEPRECIATED';
  acquisitionDate: string;
  serviceDate: string | null;
  acquisitionCost: string;
  residualValue: string;
  usefulLifeYears: number;
  depreciationMethod: string;
  location: string | null;
  reference: string | null;
  notes: string | null;
  category: { code: string; name: string } | null;
  assetAccount: { code: string; label: string };
  depreciationAccount: { code: string; label: string } | null;
  depreciationExpenseAccount: { code: string; label: string } | null;
  supplier: { code: string; name: string } | null;
  invoice: { invoiceNumber: string } | null;
  depreciationEntries: DepreciationEntryRow[];
  disposal: AssetDisposal | null;
}
interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  ACQUIRED: 'Acquise (pas encore en service)',
  IN_SERVICE: 'En service',
  UNDER_MAINTENANCE: 'En maintenance',
  DISPOSED: 'Cédée',
  FULLY_DEPRECIATED: 'Totalement amortie',
};

function fmt(n: string | number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FixedAssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [asset, setAsset] = useState<FixedAssetDetail | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [showDisposal, setShowDisposal] = useState(false);
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalType, setDisposalType] = useState<'SALE' | 'SCRAPPING' | 'OTHER'>('SALE');
  const [disposalPrice, setDisposalPrice] = useState('0');
  const [counterpartAccountId, setCounterpartAccountId] = useState('');
  const [resultAccountId, setResultAccountId] = useState('');

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<FixedAssetDetail>(`/companies/${currentCompanyId}/fixed-assets/${params.id}`);
      setAsset(data);
    } catch {
      setError('Immobilisation introuvable.');
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

  async function handlePutInService(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/fixed-assets/${params.id}/put-in-service`, { serviceDate });
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

  async function handleDisposal(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/fixed-assets/${params.id}/disposal`, {
        disposalDate,
        disposalType,
        disposalPrice: parseFloat(disposalPrice) || 0,
        counterpartAccountId: Number(disposalPrice) > 0 ? counterpartAccountId || undefined : undefined,
        resultAccountId,
      });
      setShowDisposal(false);
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

  if (error && !asset) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/assets">Retour</a>
      </main>
    );
  }
  if (!asset) return <main style={{ maxWidth: 800, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>
        {asset.code} — {asset.label}
      </h1>
      {actionError && <p role="alert" style={{ color: 'red' }}>{actionError}</p>}

      <p>Statut : <strong>{STATUS_LABELS[asset.status] ?? asset.status}</strong></p>
      <p>Catégorie : {asset.category ? `${asset.category.code} — ${asset.category.name}` : '—'}</p>
      <p>Compte d&apos;immobilisation : {asset.assetAccount.code} — {asset.assetAccount.label}</p>
      {asset.depreciationAccount && <p>Compte d&apos;amortissement : {asset.depreciationAccount.code} — {asset.depreciationAccount.label}</p>}
      {asset.depreciationExpenseAccount && <p>Compte de dotation : {asset.depreciationExpenseAccount.code} — {asset.depreciationExpenseAccount.label}</p>}
      {asset.supplier && <p>Fournisseur : {asset.supplier.code} — {asset.supplier.name}</p>}
      {asset.invoice && <p>Facture liée : {asset.invoice.invoiceNumber}</p>}
      <p>Date d&apos;acquisition : {asset.acquisitionDate.slice(0, 10)}</p>
      {asset.serviceDate && <p>Date de mise en service : {asset.serviceDate.slice(0, 10)}</p>}
      <p>Coût d&apos;acquisition : {fmt(asset.acquisitionCost)} — Valeur résiduelle : {fmt(asset.residualValue)}</p>
      <p>Durée d&apos;utilité : {asset.usefulLifeYears} ans — Méthode : {asset.depreciationMethod === 'STRAIGHT_LINE' ? 'Linéaire' : 'Dégressif'}</p>
      {asset.location && <p>Localisation : {asset.location}</p>}
      {asset.reference && <p>Référence : {asset.reference}</p>}
      {asset.notes && <p>Notes : {asset.notes}</p>}

      <div style={{ margin: '1rem 0' }}>
        <a href={`/accounting/assets/${asset.id}/edit`}>
          <button type="button">Modifier la fiche</button>
        </a>{' '}
        <a href={`/accounting/assets/${asset.id}/depreciation`}>
          <button type="button">Plan d&apos;amortissement</button>
        </a>
      </div>

      {asset.status === 'ACQUIRED' && (
        <>
          <h2>Mise en service</h2>
          <form onSubmit={handlePutInService} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="serviceDate">Date de mise en service</label>
              <br />
              <input id="serviceDate" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />
            </div>
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Traitement…' : 'Mettre en service'}
            </button>
          </form>
        </>
      )}

      {(asset.status === 'IN_SERVICE' || asset.status === 'FULLY_DEPRECIATED') && !asset.disposal && (
        <>
          <h2>Cession / sortie</h2>
          {!showDisposal ? (
            <button type="button" onClick={() => setShowDisposal(true)}>
              Céder cette immobilisation
            </button>
          ) : (
            <form onSubmit={handleDisposal}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div>
                  <label htmlFor="disposalDate">Date de cession</label>
                  <br />
                  <input id="disposalDate" type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} required />
                </div>
                <div>
                  <label htmlFor="disposalType">Type</label>
                  <br />
                  <select id="disposalType" value={disposalType} onChange={(e) => setDisposalType(e.target.value as 'SALE' | 'SCRAPPING' | 'OTHER')}>
                    <option value="SALE">Vente</option>
                    <option value="SCRAPPING">Mise au rebut</option>
                    <option value="OTHER">Autre</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="disposalPrice">Prix de cession</label>
                  <br />
                  <input id="disposalPrice" type="number" min="0" step="0.01" value={disposalPrice} onChange={(e) => setDisposalPrice(e.target.value)} />
                </div>
              </div>
              {Number(disposalPrice) > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <label htmlFor="counterpartAccountId">Compte encaissant le prix de cession</label>
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
              )}
              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor="resultAccountId">Compte de résultat exceptionnel (plus/moins-value)</label>
                <br />
                <select id="resultAccountId" value={resultAccountId} onChange={(e) => setResultAccountId(e.target.value)} required>
                  <option value="">— choisir —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
                {isSaving ? 'Traitement…' : 'Confirmer la cession'}
              </button>{' '}
              <button type="button" onClick={() => setShowDisposal(false)}>
                Annuler
              </button>
            </form>
          )}
        </>
      )}

      {asset.disposal && (
        <>
          <h2>Cession enregistrée</h2>
          <p>Date : {asset.disposal.disposalDate.slice(0, 10)} — Type : {asset.disposal.disposalType}</p>
          <p>Valeur brute : {fmt(asset.disposal.grossValue)} — Amortissements cumulés : {fmt(asset.disposal.accumulatedDepreciation)}</p>
          <p>Valeur nette comptable : {fmt(asset.disposal.netBookValue)} — Prix de cession : {fmt(asset.disposal.disposalPrice)}</p>
          <p>
            Résultat : <strong style={{ color: Number(asset.disposal.result) >= 0 ? 'green' : 'red' }}>
              {Number(asset.disposal.result) >= 0 ? '+' : ''}
              {fmt(asset.disposal.result)} ({Number(asset.disposal.result) >= 0 ? 'plus-value' : 'moins-value'})
            </strong>
          </p>
        </>
      )}

      {asset.depreciationEntries.length > 0 && (
        <>
          <h2>Dotations enregistrées</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Exercice</th>
                <th align="right">Dotation</th>
                <th align="right">Cumul</th>
                <th align="right">VNC</th>
              </tr>
            </thead>
            <tbody>
              {asset.depreciationEntries.map((d) => (
                <tr key={d.id}>
                  <td>{d.fiscalYear}</td>
                  <td align="right">{fmt(d.amount)}</td>
                  <td align="right">{fmt(d.accumulated)}</td>
                  <td align="right">{fmt(d.netBookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <AttachmentsPanel companyId={currentCompanyId!} entityType="fixedAsset" entityId={asset.id} />

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/assets">Retour à la liste des immobilisations</a>
      </p>
    </main>
  );
}
