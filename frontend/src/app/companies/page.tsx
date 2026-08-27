'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { useCompany } from '../../lib/company-context';

export default function CompaniesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { companies, isLoading } = useCompany();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || isLoading) {
    return <main style={{ maxWidth: 600, margin: '4rem auto' }}>Chargement…</main>;
  }

  return (
    <main style={{ maxWidth: 600, margin: '4rem auto' }}>
      <h1>Mes entreprises</h1>
      {companies.length === 0 ? (
        <p>Vous n&apos;appartenez encore à aucune entreprise.</p>
      ) : (
        <ul>
          {companies.map((c) => (
            <li key={c.companyId} style={{ marginBottom: '0.5rem' }}>
              <a href={`/companies/${c.companyId}`}>{c.companyName}</a> — <em>{c.roleName}</em>
              {c.isDefault && ' (par défaut)'}
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/companies/new">+ Créer une nouvelle entreprise</a>
      </p>
      <p>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
