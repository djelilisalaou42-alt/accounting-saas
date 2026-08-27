'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface JournalLine {
  account: { code: string; label: string };
  label: string | null;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
}
interface JournalEntry {
  id: string;
  entryDate: string;
  entryNumber: string;
  label: string;
  status: string;
  journal: { code: string; label: string };
  lines: JournalLine[];
}
interface JournalResponse {
  period: { startDate: string; endDate: string };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  entries: JournalEntry[];
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function JournalReportPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [journalId, setJournalId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [journals, setJournals] = useState<Array<{ id: string; code: string; label: string }>>([]);

  const [report, setReport] = useState<JournalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (journalId) params.journalId = journalId;
      if (status) params.status = status;
      const { data } = await apiClient.get<JournalResponse>(`/companies/${currentCompanyId}/reports/journal`, { params });
      setReport(data);
    } catch {
      setError('Impossible de charger le journal (permission REPORT.READ requise).');
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }, [currentCompanyId, startDate, endDate, journalId, status, page]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      load();
      apiClient.get(`/companies/${currentCompanyId}/journals`).then(({ data }) => setJournals(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, load]);

  function handleExport() {
    if (!currentCompanyId) return;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (journalId) params.set('journalId', journalId);
    if (status) params.set('status', status);
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/reports/journal/export?${params.toString()}`, '_blank');
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
      <h1>Journal comptable</h1>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="startDate">Du</label>
          <br />
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="endDate">Au</label>
          <br />
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="journalId">Journal</label>
          <br />
          <select id="journalId" value={journalId} onChange={(e) => setJournalId(e.target.value)}>
            <option value="">Tous</option>
            {journals.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status">Statut</label>
          <br />
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Validées + reversées</option>
            <option value="DRAFT">Brouillon</option>
            <option value="VALIDATED">Validée</option>
            <option value="REVERSED">Reversée</option>
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={() => { setPage(1); load(); }}>Rechercher</button>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      {isLoading && <p>Chargement…</p>}

      {report && (
        <>
          <p>
            Période : {report.period.startDate.toString().slice(0, 10)} → {report.period.endDate.toString().slice(0, 10)} — {report.pagination.total} écriture(s)
          </p>
          {report.entries.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune écriture.</p>
          ) : (
            report.entries.map((e) => (
              <table key={e.id} style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                <thead>
                  <tr>
                    <th align="left" colSpan={2}>
                      {e.entryDate.toString().slice(0, 10)} — {e.entryNumber} ({e.journal.code}) — {e.label} [{e.status}]
                    </th>
                    <th align="right">Débit</th>
                    <th align="right">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.account.code} — {l.account.label}</td>
                      <td>{l.label ?? ''}</td>
                      <td align="right">{l.side === 'DEBIT' ? fmt(l.amount) : ''}</td>
                      <td align="right">{l.side === 'CREDIT' ? fmt(l.amount) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))
          )}

          {report.pagination.totalPages > 1 && (
            <p>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Précédent</button>{' '}
              Page {report.pagination.page} / {report.pagination.totalPages}{' '}
              <button disabled={page >= report.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant →</button>
            </p>
          )}

          <p>
            <button onClick={handleExport}>Exporter en CSV</button>
          </p>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/reports">Retour aux rapports</a>
      </p>
    </main>
  );
}
