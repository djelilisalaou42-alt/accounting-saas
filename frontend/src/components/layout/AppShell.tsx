'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { Sidebar } from './Sidebar';

// Pages publiques : gardent une mise en page centrée simple, jamais de
// sidebar — même si l'utilisateur a par ailleurs une session active (ex:
// il revient volontairement sur /login, ou ouvre un lien d'invitation
// dans un onglet où il est déjà connecté avec un autre compte).
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/companies/invitations',
];

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATH_PREFIXES.some((p) => pathname?.startsWith(p));

  // Pendant le refresh silencieux au chargement (isLoading), on affiche
  // les pages sans habillage plutôt qu'un flash de sidebar qui
  // disparaîtrait aussitôt si la session s'avère invalide.
  if (isLoading || !isAuthenticated || isPublicPath) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
