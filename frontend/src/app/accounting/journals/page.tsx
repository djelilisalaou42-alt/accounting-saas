'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface Journal {
  id: string;
  code: string;
  label: string;
  type: string;
  isActive: boolean;
}

const JOURNAL_TYPES = ['SALES', 'PURCHASES', 'CASH', 'BANK', 'GENERAL', 'PAYROLL', 'OPENING', 'CLOSING'];

export default function JournalsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('GENERAL');
  const [isCreating, setIsCreating] = useState(false);

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<Journal[]>(`/companies/${currentCompanyId}/journals`);
      setJournals(data);
    } catch {
      setError('Impossible de charger les journaux (permission JOURNAL.READ requise).');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/journals`, { code, label, type });
      setCode('');
      setLabel('');
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  async function toggle(journalId: string, currentlyActive: boolean) {
    await apiClient.post(`/companies/${currentCompanyId}/journals/${journalId}/${currentlyActive ? 'disable' : 'enable'}`);
    load();
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour gérer ses journaux.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Journaux comptables</h1>
      <p style={{ fontSize: '0.9em', color: '#666' }}>
        Les journaux ci-dessous (ACH, VEN, BQ, CA, OD...) sont des exemples de configuration, pas une
        nomenclature légale obligatoire — libre à vous d&apos;en créer d&apos;autres.
      </p>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {journals === null ? (
        <p>Chargement…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Libellé</th>
              <th align="left">Type</th>
              <th align="left">Statut</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {journals.map((j) => (
              <tr key={j.id}>
                <td>{j.code}</td>
                <td>{j.label}</td>
                <td>{j.type}</td>
                <td>{j.isActive ? 'Actif' : 'Inactif'}</td>
                <td>
                  <button onClick={() => toggle(j.id, j.isActive)}>{j.isActive ? 'Désactiver' : 'Activer'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Créer un journal</h2>
      <form onSubmit={handleCreate}>
        <div>
          <label htmlFor="code">Code</label>
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={10} placeholder="VEN" />
        </div>
        <div>
          <label htmlFor="label">Libellé</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="Ventes" />
        </div>
        <div>
          <label htmlFor="type">Type</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
            {JOURNAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={isCreating}>
          {isCreating ? 'Création…' : 'Créer le journal'}
        </button>
      </form>

      <p>
        <a href="/accounting/entries">Voir les écritures</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
