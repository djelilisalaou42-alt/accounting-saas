'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, setAccessToken, getAccessToken } from './api-client';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchCurrentUser = useCallback(async () => {
    const { data } = await apiClient.get<AuthUser>('/auth/me');
    setUser(data);
  }, []);

  // Renouvellement silencieux au chargement de l'application : l'access
  // token vit uniquement en mémoire (perdu au rechargement de page), le
  // cookie HttpOnly du refresh token permet de le reconstituer sans
  // demander à nouveau les identifiants — tant que la session est
  // encore valide côté serveur.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const { data } = await apiClient.post<{ accessToken: string }>('/auth/refresh');
        if (cancelled) return;
        setAccessToken(data.accessToken);
        await fetchCurrentUser();
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    bootstrap();

    function handleSessionExpired() {
      setUser(null);
      setAccessToken(null);
      router.push('/login');
    }
    window.addEventListener('auth:session-expired', handleSessionExpired);

    return () => {
      cancelled = true;
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiClient.post<{ accessToken: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  const refreshUser = useCallback(async () => {
    if (getAccessToken()) {
      await fetchCurrentUser();
    }
  }, [fetchCurrentUser]);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé à l\'intérieur de <AuthProvider>.');
  }
  return ctx;
}
