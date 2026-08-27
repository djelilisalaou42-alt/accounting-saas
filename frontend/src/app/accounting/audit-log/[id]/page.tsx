'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface AuditLogDetail {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  user: { firstName: string; lastName: string; email: string } | null;
}

export default function AuditLogDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [log, setLog] = useState<AuditLogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient
        .get<AuditLogDetail>(`/companies/${currentCompanyId}/audit-logs/${params.id}`)
        .then(({ data }) => setLog(data))
        .catch(() => setError("Événement introuvable ou permission AUDIT.READ requise."));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  if (error) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/audit-log">Retour</a>
      </main>
    );
  }
  if (!log) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Événement d&apos;audit</h1>
      <p style={{ fontStyle: 'italic', color: '#666' }}>Trace historique en lecture seule.</p>

      <p>Date : {new Date(log.createdAt).toLocaleString('fr-FR')}</p>
      <p>Utilisateur : {log.user ? `${log.user.firstName} ${log.user.lastName} (${log.user.email})` : '—'}</p>
      <p>Action : <strong>{log.action}</strong></p>
      <p>Objet : {log.entityType}{log.entityId ? ` — ${log.entityId}` : ''}</p>

      <h2>Avant</h2>
      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: 4, overflowX: 'auto' }}>
        {log.oldValue ? JSON.stringify(log.oldValue, null, 2) : '—'}
      </pre>

      <h2>Après</h2>
      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: 4, overflowX: 'auto' }}>
        {log.newValue ? JSON.stringify(log.newValue, null, 2) : '—'}
      </pre>

      {(log.ipAddress || log.userAgent) && (
        <>
          <h2>Contexte</h2>
          {log.ipAddress && <p>Adresse IP : {log.ipAddress}</p>}
          {log.userAgent && <p>User-Agent : {log.userAgent}</p>}
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/audit-log">Retour au journal</a>
      </p>
    </main>
  );
}
