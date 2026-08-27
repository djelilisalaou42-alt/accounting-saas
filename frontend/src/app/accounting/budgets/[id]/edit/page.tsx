'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';

export default function EditBudgetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/budgets/${params.id}`).then(({ data }) => {
        setName(data.name);
        setDescription(data.description ?? '');
        setLoaded(true);
      });
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.patch(`/companies/${currentCompanyId}/budgets/${params.id}`, { name, description: description || undefined });
      router.push(`/accounting/budgets/${params.id}`);
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
      <h1>Modifier le budget</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Nom</label>
          <br />
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="description">Description</label>
          <br />
          <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
      <p>
        <a href={`/accounting/budgets/${params.id}`}>Annuler</a>
      </p>
    </main>
  );
}
