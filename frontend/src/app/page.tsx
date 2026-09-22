'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

// Sélecteur d'entreprise, infos utilisateur et déconnexion vivent
// désormais dans la sidebar (AppShell/Sidebar), affichée sur toutes les
// pages authentifiées — cette page ne les duplique plus.
export default function HomePage() {
  const { user, isLoading, isAuthenticated } = useAuth();
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
    <main>
      <h1>Bonjour {user.firstName} {user.lastName}</h1>
      <p>Utilisez le menu à gauche pour accéder aux différents modules.</p>
      <p>
        <a href="/accounting/dashboard">Aller au tableau de bord →</a>
      </p>
    </main>
  );
}
