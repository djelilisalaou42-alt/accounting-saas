'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { apiClient } from '../../../lib/api-client';

interface TaxRow {
  id: string;
  country: string;
  code: string;
  label: string;
  type: 'VAT' | 'WITHHOLDING' | 'OTHER';
  rate: string;
  isActive: boolean;
}

const TYPE_LABELS: Record<string, string> = { VAT: 'TVA', WITHHOLDING: 'Retenue à la source', OTHER: 'Autre' };

export default function TaxesListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [taxes, setTaxes] = useState<TaxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated) {
      apiClient
        .get('/taxes', { params: { includeInactive: 'true' } })
        .then(({ data }) => setTaxes(data))
        .catch(() => setError('Impossible de charger le référentiel fiscal.'));
    }
  }, [authLoading, isAuthenticated, router]);

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Taxes — référentiel fiscal</h1>
      <p style={{ fontStyle: 'italic', color: '#666' }}>
        Référentiel global par pays, partagé entre toutes les entreprises (comme le plan comptable
        de référence) — sa gestion (création/modification) est réservée à un administrateur
        plateforme.
      </p>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/accounting/taxes/settings">
          <button type="button">Configuration fiscale de l&apos;entreprise</button>
        </a>{' '}
        <a href="/accounting/taxes/declarations">
          <button type="button">Déclarations fiscales</button>
        </a>
      </p>

      {taxes === null ? (
        <p>Chargement…</p>
      ) : taxes.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune taxe configurée.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Pays</th>
              <th align="left">Code</th>
              <th align="left">Libellé</th>
              <th align="left">Type</th>
              <th align="right">Taux</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {taxes.map((t) => (
              <tr key={t.id}>
                <td>{t.country}</td>
                <td>{t.code}</td>
                <td>{t.label}</td>
                <td>{TYPE_LABELS[t.type] ?? t.type}</td>
                <td align="right">{Number(t.rate).toFixed(2)} %</td>
                <td>{t.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
