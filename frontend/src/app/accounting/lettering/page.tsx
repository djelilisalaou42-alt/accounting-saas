'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface AccountOption {
  id: string;
  code: string;
  label: string;
  isPostable: boolean;
  isActive: boolean;
  accountClass?: { code: string };
}

interface LetteringSummary {
  id: string;
  code: string;
  account: { id: string; code: string; label: string };
  status: 'OPEN' | 'CLOSED' | 'CANCELED';
  createdAt: string;
  totalDebit: number;
  totalCredit: number;
  difference: number;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LetteringPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [letterings, setLetterings] = useState<LetteringSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/accounts`);
      // Comptes de tiers : classe comptable "4" (Comptes de tiers) —
      // métadonnée du référentiel existant, jamais un code en dur
      // comme 401/411. Les comptes des autres classes restent
      // accessibles ailleurs (plan comptable) mais ne sont pas
      // pertinents pour le lettrage, principalement destiné aux tiers.
      setAccounts(data.filter((a: AccountOption) => a.isPostable && a.isActive));
    } catch {
      setError('Impossible de charger les comptes (permission ACCOUNT.READ requise).');
    }
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/lettering`, { params });
      setLetterings(data.letterings);
    } catch {
      setError((prev) => prev ?? 'Impossible de charger les lettrages (permission LETTERING.READ requise).');
    }
  }, [currentCompanyId, statusFilter, search]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
  }, [authLoading, isAuthenticated, currentCompanyId, load, router]);

  const filteredAccounts = accounts?.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q);
  });

  // Comptes de classe 4 (tiers) mis en avant en premier, sans exclure
  // les autres — le backend accepte tout compte postable pour le
  // lettrage, seule la présentation frontend suggère les tiers en
  // priorité (§5 du cahier des charges : "principalement destiné").
  const tiersAccounts = filteredAccounts?.filter((a) => a.accountClass?.code === '4');
  const otherAccounts = filteredAccounts?.filter((a) => a.accountClass?.code !== '4');

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour accéder au lettrage.</p>
        <a href="/">Retour</a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Lettrage comptable</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <input placeholder="Rechercher un compte…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', marginBottom: '1rem' }} />

      <h2>Comptes de tiers</h2>
      {accounts === null ? (
        <p>Chargement…</p>
      ) : tiersAccounts && tiersAccounts.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Libellé</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tiersAccounts.map((a) => (
              <tr key={a.id}>
                <td>{a.code}</td>
                <td>{a.label}</td>
                <td>
                  <a href={`/accounting/lettering/account/${a.id}`}>
                    <button type="button">Lettrer</button>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontStyle: 'italic' }}>Aucun compte de tiers trouvé.</p>
      )}

      {otherAccounts && otherAccounts.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary>Autres comptes postables ({otherAccounts.length}) — non éligibles au lettrage</summary>
          <p style={{ fontSize: '0.85em', color: '#666' }}>
            Le lettrage est réservé aux comptes de tiers (classe 4). Ces comptes sont affichés pour
            information uniquement.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
            <tbody>
              {otherAccounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td>
                  <td>{a.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <h2 style={{ marginTop: '2rem' }}>Lettrages existants</h2>
      <div style={{ marginBottom: '0.5rem' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="OPEN">En cours</option>
          <option value="CLOSED">Clôturé</option>
          <option value="CANCELED">Délettré</option>
        </select>
      </div>
      {letterings === null ? (
        <p>Chargement…</p>
      ) : letterings.length === 0 ? (
        <p style={{ fontStyle: 'italic' }}>Aucun lettrage.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Compte</th>
              <th align="right">Débit</th>
              <th align="right">Crédit</th>
              <th align="left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {letterings.map((lt) => (
              <tr key={lt.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/accounting/lettering/${lt.id}`)}>
                <td>{lt.code}</td>
                <td>
                  {lt.account.code} — {lt.account.label}
                </td>
                <td align="right">{fmt(lt.totalDebit)}</td>
                <td align="right">{fmt(lt.totalCredit)}</td>
                <td>{lt.status === 'OPEN' ? 'En cours' : lt.status === 'CLOSED' ? 'Clôturé' : 'Délettré'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '1rem' }}>
        <a href="/accounting/general-ledger">Grand livre</a> · <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
