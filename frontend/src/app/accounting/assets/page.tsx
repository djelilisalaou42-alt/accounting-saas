'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface FixedAssetRow {
  id: string;
  code: string;
  label: string;
  status: 'ACQUIRED' | 'IN_SERVICE' | 'UNDER_MAINTENANCE' | 'DISPOSED' | 'FULLY_DEPRECIATED';
  acquisitionCost: string;
  category: { code: string; name: string } | null;
  assetAccount: { code: string; label: string };
}

const STATUS_LABELS: Record<string, string> = {
  ACQUIRED: 'Acquise',
  IN_SERVICE: 'En service',
  UNDER_MAINTENANCE: 'En maintenance',
  DISPOSED: 'Cédée',
  FULLY_DEPRECIATED: 'Totalement amortie',
};

function fmt(n: string | number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FixedAssetsListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [assets, setAssets] = useState<FixedAssetRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      const params: Record<string, string | number> = { page };
      if (search) params.search = search;
      if (status) params.status = status;
      apiClient
        .get(`/companies/${currentCompanyId}/fixed-assets`, { params })
        .then(({ data }) => {
          setAssets(data.assets);
          setTotalPages(data.pagination.totalPages);
        })
        .catch(() => setError('Impossible de charger les immobilisations (permission ASSET.READ requise).'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, router, search, status, page]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 1000, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: '4rem auto' }}>
      <h1>Immobilisations</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <p>
        <a href="/accounting/assets/new">
          <button type="button">+ Nouvelle immobilisation</button>
        </a>{' '}
        <a href="/accounting/assets/categories">
          <button type="button">Catégories</button>
        </a>
      </p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <input
          placeholder="Rechercher (code, libellé)"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {assets === null ? (
        <p>Chargement…</p>
      ) : assets.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucune immobilisation.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Libellé</th>
              <th align="left">Catégorie</th>
              <th align="left">Compte</th>
              <th align="right">Coût d&apos;acquisition</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/assets/${a.id}`)}>
                <td>{a.code}</td>
                <td>{a.label}</td>
                <td>{a.category ? `${a.category.code} — ${a.category.name}` : '—'}</td>
                <td>{a.assetAccount.code} — {a.assetAccount.label}</td>
                <td align="right">{fmt(a.acquisitionCost)}</td>
                <td>{STATUS_LABELS[a.status] ?? a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <p style={{ marginTop: '1rem' }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Précédent
          </button>{' '}
          Page {page} / {totalPages}{' '}
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Suivant →
          </button>
        </p>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
