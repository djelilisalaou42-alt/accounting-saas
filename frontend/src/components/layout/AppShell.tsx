'use client';

import { ReactNode } from 'react';
import { useAuth } from '../../lib/auth-context';
import { Sidebar } from './Sidebar';

/**
 * N'affiche la barre latérale que pour un utilisateur authentifié — les
 * pages publiques (login, register, forgot/reset-password, acceptation
 * d'invitation) gardent une mise en page centrée simple, sans menu.
 * Pendant le refresh silencieux au chargement (isLoading), on affiche les
 * pages sans habillage plutôt qu'un flash de sidebar qui disparaîtrait
 * aussitôt si la session s'avère invalide.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
