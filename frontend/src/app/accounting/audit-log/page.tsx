'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  user: { firstName: string; lastName: string; email: string } | null;
}
interface AuditLogResponse {
  logs: AuditLogRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const ACTION_OPTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'REVERSE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'EXPORT',
  'CLOSE_PERIOD', 'REOPEN_PERIOD', 'LETTERING', 'UNLETTERING', 'MEMBER_ROLE_CHANGE', 'MEMBER_DISABLE',
  'MEMBER_ENABLE', 'ACCOUNT_DISABLE', 'ACCOUNT_ENABLE',
];

export default function AuditLogListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setError(null);
    try {
      const params: Record<string, string | number> = { page, sortBy: 'createdAt', sortOrder };
      if (action) params.action = action;
      if (entityType) params.entityType = entityType;
      if (entityId) params.entityId = entityId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const { data } = await apiClient.get<AuditLogResponse>(`/companies/${currentCompanyId}/audit-logs`, { params });
      setData(data);
    } catch {
      setError("Impossible de charger le journal d'audit (permission AUDIT.READ requise).");
      setData(null);
    }
  }, [currentCompanyId, action, entityType, entityId, startDate, endDate, sortOrder, page]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  async function handleExport() {
    if (!currentCompanyId) return;
    setExportError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (entityType) params.set('entityType', entityType);
      if (entityId) params.set('entityId', entityId);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/companies/${currentCompanyId}/audit-logs/export/csv?${params.toString()}`, '_blank');
    } catch {
      setExportError("Impossible d'exporter le journal (permission AUDIT.EXPORT requise).");
    }
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 1000, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: '4rem auto' }}>
      <h1>Journal d&apos;audit</h1>
      <p style={{ fontStyle: 'italic', color: '#666' }}>
        Trace historique en lecture seule — aucune entrée ne peut être modifiée ou supprimée, y
        compris par un administrateur (protection appliquée au niveau de la base de données).
      </p>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      {exportError && <p role="alert" style={{ color: 'red' }}>{exportError}</p>}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="action">Action</label>
          <br />
          <select id="action" value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
            <option value="">Toutes</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entityType">Type d&apos;objet</label>
          <br />
          <input id="entityType" value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }} placeholder="Invoice, Budget…" />
        </div>
        <div>
          <label htmlFor="entityId">ID objet</label>
          <br />
          <input id="entityId" value={entityId} onChange={(e) => { setPage(1); setEntityId(e.target.value); }} />
        </div>
        <div>
          <label htmlFor="startDate">Du</label>
          <br />
          <input id="startDate" type="date" value={startDate} onChange={(e) => { setPage(1); setStartDate(e.target.value); }} />
        </div>
        <div>
          <label htmlFor="endDate">Au</label>
          <br />
          <input id="endDate" type="date" value={endDate} onChange={(e) => { setPage(1); setEndDate(e.target.value); }} />
        </div>
        <div>
          <label htmlFor="sortOrder">Tri</label>
          <br />
          <select id="sortOrder" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}>
            <option value="desc">Plus récent d&apos;abord</option>
            <option value="asc">Plus ancien d&apos;abord</option>
          </select>
        </div>
      </div>

      {data && (
        <>
          <p>{data.pagination.total} événement(s)</p>
          {data.logs.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucun événement.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Utilisateur</th>
                  <th align="left">Action</th>
                  <th align="left">Objet</th>
                  <th align="left">ID objet</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l) => (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/audit-log/${l.id}`)}>
                    <td>{new Date(l.createdAt).toLocaleString('fr-FR')}</td>
                    <td>{l.user ? `${l.user.firstName} ${l.user.lastName}` : '—'}</td>
                    <td>{l.action}</td>
                    <td>{l.entityType}</td>
                    <td>{l.entityId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.pagination.totalPages > 1 && (
            <p style={{ marginTop: '1rem' }}>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Précédent</button>{' '}
              Page {data.pagination.page} / {data.pagination.totalPages}{' '}
              <button disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant →</button>
            </p>
          )}

          <p style={{ marginTop: '1rem' }}>
            <button onClick={handleExport}>Exporter en CSV</button>
          </p>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
