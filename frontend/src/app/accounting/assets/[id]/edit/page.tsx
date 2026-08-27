'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

export default function EditFixedAssetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/fixed-assets/${params.id}`).then(({ data }) => {
        setLabel(data.label);
        setLocation(data.location ?? '');
        setReference(data.reference ?? '');
        setNotes(data.notes ?? '');
        setLoaded(true);
      });
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.patch(`/companies/${currentCompanyId}/fixed-assets/${params.id}`, {
        label,
        location: location || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      router.push(`/accounting/assets/${params.id}`);
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

  if (!loaded) return <main style={{ maxWidth: 600, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 600, margin: '4rem auto' }}>
      <h1>Modifier l&apos;immobilisation</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="label">Libellé</label>
          <br />
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
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
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
      <p>
        <a href={`/accounting/assets/${params.id}`}>Annuler</a>
      </p>
    </main>
  );
}
