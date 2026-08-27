'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { CompanySelector } from '../../../components/layout/CompanySelector';

export default function AccountingSettingsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login');
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) return <main style={{ maxWidth: 600, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 600, margin: '4rem auto' }}>
      <h1>Paramètres comptables</h1>
      <p>
        <CompanySelector />
      </p>
      {!currentCompanyId ? (
        <p>Sélectionnez ou créez une entreprise pour configurer sa comptabilité.</p>
      ) : (
        <ul>
          <li>
            <a href="/settings/accounting/framework">Référentiel comptable</a> — SYSCOHADA et classes utilisées
          </li>
          <li>
            <a href="/settings/accounting/periods">Exercices comptables</a> — création, clôture, réouverture
          </li>
          <li>
            <a href="/settings/accounting/accounts">Plan comptable</a> — arborescence, création, import CSV
          </li>
        </ul>
      )}
      <p>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
