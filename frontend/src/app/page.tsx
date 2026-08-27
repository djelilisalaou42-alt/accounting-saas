'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { CompanySelector } from '../components/layout/CompanySelector';

export default function HomePage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return <main style={{ maxWidth: 400, margin: '4rem auto' }}>Chargement…</main>;
  }

  if (!user) {
    return null; // redirection en cours
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto' }}>
      <h1>Bonjour {user.firstName} {user.lastName}</h1>
      <p>Email : {user.email}</p>
      <p>Statut : {user.status}</p>
      <p>
        <CompanySelector />
      </p>
      <p>
        <a href="/companies">Gérer mes entreprises</a>
      </p>
      <button onClick={() => logout()}>Se déconnecter</button>
    </main>
  );
}
