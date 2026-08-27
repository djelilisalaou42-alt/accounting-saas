'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface EntryRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  label: string;
  status: 'DRAFT' | 'VALIDATED' | 'REVERSED';
  totalDebit: string;
  totalCredit: string;
  journal: { code: string; label: string };
  createdBy: { firstName: string; lastName: string };
  validatedAt: string | null;
}

interface Journal {
  id: string;
  code: string;
  label: string;
}

export default function AccountingEntriesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [journalFilter, setJournalFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (journalFilter) params.journalId = journalFilter;
      if (search) params.search = search;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/accounting-entries`, { params });
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      setError('Impossible de charger les écritures (permission ENTRY.READ requise).');
    }
  }, [currentCompanyId, statusFilter, journalFilter, search]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      loadEntries();
      apiClient.get(`/companies/${currentCompanyId}/journals`).then(({ data }) => setJournals(data));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, loadEntries, router]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour consulter ses écritures.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Écritures comptables</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <input placeholder="Rechercher (numéro ou libellé)…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="DRAFT">Brouillon</option>
          <option value="VALIDATED">Validée</option>
          <option value="REVERSED">Contrepassée</option>
        </select>
        <select value={journalFilter} onChange={(e) => setJournalFilter(e.target.value)}>
          <option value="">Tous journaux</option>
          {journals.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} — {j.label}
            </option>
          ))}
        </select>
        <a href="/accounting/entries/new">
          <button type="button">+ Nouvelle écriture</button>
        </a>
      </div>

      {entries === null ? (
        <p>Chargement…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Numéro</th>
                <th align="left">Date</th>
                <th align="left">Journal</th>
                <th align="left">Libellé</th>
                <th align="right">Montant</th>
                <th align="left">Statut</th>
                <th align="left">Créateur</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/entries/${e.id}`)}>
                  <td>{e.entryNumber}</td>
                  <td>{e.entryDate.slice(0, 10)}</td>
                  <td>{e.journal.code}</td>
                  <td>{e.label}</td>
                  <td align="right">{Number(e.totalDebit).toLocaleString('fr-FR')}</td>
                  <td>{e.status}</td>
                  <td>
                    {e.createdBy.firstName} {e.createdBy.lastName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{total} écriture(s) au total.</p>
        </>
      )}

      <p>
        <a href="/accounting/journals">Gérer les journaux</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
