'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { useCompany } from '../../lib/company-context';
import { apiClient } from '../../lib/api-client';

interface Supplier {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  account: { code: string; label: string } | null;
}

export default function SuppliersPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/suppliers`, { params });
      setSuppliers(data.suppliers);
    } catch {
      setError('Impossible de charger les fournisseurs (permission SUPPLIER.READ requise).');
    }
  }, [currentCompanyId, search]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour gérer ses fournisseurs.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Fournisseurs</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
        <button onClick={load}>Rechercher</button>
        <a href="/suppliers/new">
          <button type="button">+ Nouveau fournisseur</button>
        </a>
      </div>

      {suppliers === null ? (
        <p>Chargement…</p>
      ) : suppliers.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun fournisseur.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Nom</th>
              <th align="left">Compte</th>
              <th align="left">Email</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/suppliers/${c.id}`)}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>{c.account ? `${c.account.code} — ${c.account.label}` : '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td>{c.isActive ? 'Actif' : 'Inactif'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/customers">Clients</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
