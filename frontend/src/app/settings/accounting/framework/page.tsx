'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface AccountClass {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  nature: string;
  category: string;
  displayOrder: number;
}

interface Framework {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  accountClasses: AccountClass[];
}

export default function AccountingFrameworkPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId, companies } = useCompany();
  const router = useRouter();
  const [frameworks, setFrameworks] = useState<Framework[] | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated) {
      apiClient.get<Framework[]>('/accounting-frameworks').then(({ data }) => setFrameworks(data));
    }
  }, [authLoading, isAuthenticated, router]);

  const currentCompany = companies.find((c) => c.companyId === currentCompanyId);

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Référentiel comptable</h1>
      {currentCompany && (
        <p>
          Entreprise : <strong>{currentCompany.companyName}</strong>
        </p>
      )}

      {frameworks === null ? (
        <p>Chargement…</p>
      ) : (
        frameworks.map((fw) => (
          <section key={fw.id} style={{ marginBottom: '2rem', opacity: fw.isActive ? 1 : 0.6 }}>
            <h2>
              {fw.name} {!fw.isActive && '(non disponible pour le moment)'}
            </h2>
            {fw.description && <p>{fw.description}</p>}
            {fw.accountClasses.length === 0 ? (
              <p style={{ fontStyle: 'italic' }}>Aucune classe seedée pour ce référentiel pour le moment.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th align="left">Classe</th>
                    <th align="left">Nom</th>
                    <th align="left">Nature</th>
                    <th align="left">Catégorie</th>
                  </tr>
                </thead>
                <tbody>
                  {fw.accountClasses.map((c) => (
                    <tr key={c.id}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.nature}</td>
                      <td>{c.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}

      <p>
        <a href="/settings/accounting">Retour aux paramètres comptables</a>
      </p>
    </main>
  );
}
