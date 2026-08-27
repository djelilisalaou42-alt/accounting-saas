'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

interface ScheduleLine {
  period: number;
  fiscalYear: number;
  amount: number;
  accumulated: number;
  netBookValue: number;
}
interface DepreciationEntryRow {
  fiscalYear: number;
  amount: string;
}
interface FixedAssetSummary {
  code: string;
  label: string;
  status: string;
  serviceDate: string | null;
  depreciationEntries: DepreciationEntryRow[];
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DepreciationSchedulePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [asset, setAsset] = useState<FixedAssetSummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduleLine[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [periodDate, setPeriodDate] = useState(`${new Date().getFullYear()}-12-31`);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data: assetData } = await apiClient.get<FixedAssetSummary>(`/companies/${currentCompanyId}/fixed-assets/${params.id}`);
      setAsset(assetData);
      const { data: scheduleData } = await apiClient.get(`/companies/${currentCompanyId}/fixed-assets/${params.id}/depreciation-schedule`);
      setSchedule(scheduleData.schedule ?? []);
      setMessage(scheduleData.message ?? null);
    } catch {
      setError('Immobilisation introuvable.');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, params.id]);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/fixed-assets/${params.id}/depreciation`, { fiscalYear, periodDate });
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

  if (error) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/assets">Retour</a>
      </main>
    );
  }
  if (!asset) return <main style={{ maxWidth: 800, margin: '4rem auto' }}>Chargement…</main>;

  const generatedYears = new Set(asset.depreciationEntries.map((d) => d.fiscalYear));

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>Plan d&apos;amortissement — {asset.code}</h1>
      <p>{asset.label}</p>
      {actionError && <p role="alert" style={{ color: 'red' }}>{actionError}</p>}

      {message && <p style={{ fontStyle: 'italic' }}>{message}</p>}

      {schedule.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
          <thead>
            <tr>
              <th align="left">Annuité</th>
              <th align="left">Exercice</th>
              <th align="right">Dotation prévue</th>
              <th align="right">Cumul prévu</th>
              <th align="right">VNC prévue</th>
              <th align="left">Générée ?</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((l) => (
              <tr key={l.period} style={{ background: generatedYears.has(l.fiscalYear) ? '#f0f0f0' : undefined }}>
                <td>{l.period}</td>
                <td>{l.fiscalYear}</td>
                <td align="right">{fmt(l.amount)}</td>
                <td align="right">{fmt(l.accumulated)}</td>
                <td align="right">{fmt(l.netBookValue)}</td>
                <td>{generatedYears.has(l.fiscalYear) ? 'Oui' : 'Non'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {asset.status === 'IN_SERVICE' && (
        <>
          <h2>Générer une dotation</h2>
          <form onSubmit={handleGenerate} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="fiscalYear">Exercice civil</label>
              <br />
              <input id="fiscalYear" type="number" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} required />
            </div>
            <div>
              <label htmlFor="periodDate">Date de dotation</label>
              <br />
              <input id="periodDate" type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} required />
            </div>
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Génération…' : 'Générer la dotation'}
            </button>
          </form>
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href={`/accounting/assets/${params.id}`}>Retour à la fiche</a>
      </p>
    </main>
  );
}
