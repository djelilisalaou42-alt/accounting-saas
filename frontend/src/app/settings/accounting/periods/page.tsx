'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
  closedBy: { firstName: string; lastName: string } | null;
  reopenedAt: string | null;
  reopenedBy: { firstName: string; lastName: string } | null;
  reopenReason: string | null;
}

export default function AccountingPeriodsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  async function loadPeriods() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<Period[]>(`/companies/${currentCompanyId}/accounting-periods`);
      setPeriods(data);
    } catch {
      setError('Impossible de charger les exercices (permission ACCOUNTING_PERIOD.READ requise).');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/accounting-periods`, { name, startDate, endDate });
      setName('');
      setStartDate('');
      setEndDate('');
      loadPeriods();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  async function handleClose(periodId: string) {
    if (!window.confirm('Clôturer cet exercice ?')) return;
    try {
      await apiClient.post(`/companies/${currentCompanyId}/accounting-periods/${periodId}/close`);
      loadPeriods();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) setError(err.response.data.message);
    }
  }

  async function handleReopenSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reopenTargetId) return;
    try {
      await apiClient.post(`/companies/${currentCompanyId}/accounting-periods/${reopenTargetId}/reopen`, { reason: reopenReason });
      setReopenTargetId(null);
      setReopenReason('');
      loadPeriods();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      }
    }
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour gérer ses exercices comptables.</p>
        <a href="/settings/accounting">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Exercices comptables</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {periods === null ? (
        <p>Chargement…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Exercice</th>
              <th align="left">Début</th>
              <th align="left">Fin</th>
              <th align="left">Statut</th>
              <th align="left">Clôturé par</th>
              <th align="left">Date de clôture</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.startDate.slice(0, 10)}</td>
                <td>{p.endDate.slice(0, 10)}</td>
                <td>{p.status}</td>
                <td>{p.closedBy ? `${p.closedBy.firstName} ${p.closedBy.lastName}` : '—'}</td>
                <td>{p.closedAt ? p.closedAt.slice(0, 10) : '—'}</td>
                <td>
                  {p.status === 'OPEN' && <button onClick={() => handleClose(p.id)}>Clôturer</button>}
                  {p.status === 'CLOSED' && (
                    <button
                      onClick={() => {
                        setReopenTargetId(p.id);
                        setReopenReason('');
                      }}
                    >
                      Rouvrir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reopenTargetId && (
        <div style={{ border: '1px solid #ccc', padding: '1rem', marginTop: '1rem' }}>
          <h2>Motif de réouverture</h2>
          <p>La réouverture d&apos;un exercice clôturé nécessite obligatoirement un motif détaillé.</p>
          <form onSubmit={handleReopenSubmit}>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              required
              minLength={10}
              rows={3}
              style={{ width: '100%' }}
              placeholder="Ex : erreur de saisie détectée lors du contrôle mensuel, correction nécessaire."
            />
            <div>
              <button type="submit">Confirmer la réouverture</button>{' '}
              <button type="button" onClick={() => setReopenTargetId(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <h2>Créer un exercice</h2>
      <form onSubmit={handleCreate}>
        <div>
          <label htmlFor="name">Nom</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Exercice 2027" />
        </div>
        <div>
          <label htmlFor="startDate">Date de début</label>
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="endDate">Date de fin</label>
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
        <button type="submit" disabled={isCreating}>
          {isCreating ? 'Création…' : "Créer l'exercice"}
        </button>
      </form>

      <p>
        <a href="/settings/accounting">Retour aux paramètres comptables</a>
      </p>
    </main>
  );
}
