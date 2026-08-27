'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

interface SettingsOption {
  id: string;
  tax: { id: string; code: string; label: string };
}

export default function NewTaxDeclarationPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsOption[]>([]);
  const [taxId, setTaxId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/tax-settings`).then(({ data }) => setSettings(data));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/tax-declarations`, {
        taxId,
        periodLabel,
        periodStart,
        periodEnd,
        dueDate,
      });
      router.push(`/accounting/taxes/declarations/${data.id}`);
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
      <h1>Nouvelle déclaration fiscale</h1>
      <p style={{ fontStyle: 'italic', color: '#666' }}>
        Les montants (TVA collectée, déductible, nette) sont calculés automatiquement depuis vos
        écritures comptables réelles de la période — jamais saisis manuellement.
      </p>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="taxId">Taxe (configurée)</label>
          <br />
          <select id="taxId" value={taxId} onChange={(e) => setTaxId(e.target.value)} required>
            <option value="">— choisir —</option>
            {settings.map((s) => (
              <option key={s.id} value={s.tax.id}>
                {s.tax.code} — {s.tax.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="periodLabel">Libellé de période (ex: Mars 2026)</label>
          <br />
          <input id="periodLabel" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label htmlFor="periodStart">Début de période</label>
            <br />
            <input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="periodEnd">Fin de période</label>
            <br />
            <input id="periodEnd" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="dueDate">Échéance</label>
            <br />
            <input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Calcul en cours…' : 'Créer la déclaration'}
        </button>
      </form>

      <p>
        <a href="/accounting/taxes/declarations">Annuler</a>
      </p>
    </main>
  );
}
