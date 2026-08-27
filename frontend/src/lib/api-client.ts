import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/**
 * L'access token est gardé UNIQUEMENT en mémoire (variable de module),
 * jamais dans localStorage/sessionStorage/IndexedDB — voir la
 * discussion complète dans le README et dans auth.controller.ts côté
 * backend. Cette variable est perdue au rechargement de la page : c'est
 * voulu, `AuthProvider` la reconstruit silencieusement au montage via
 * `/auth/refresh` (qui s'appuie sur le cookie HttpOnly, invisible ici).
 */
let inMemoryAccessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // indispensable : envoie le cookie HttpOnly du refresh token
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (inMemoryAccessToken) {
    config.headers.Authorization = `Bearer ${inMemoryAccessToken}`;
  }
  return config;
});

// File d'attente pour éviter plusieurs appels /auth/refresh concurrents
// si plusieurs requêtes échouent en 401 en même temps.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ accessToken: string }>(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    setAccessToken(null);
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Ne tente qu'UNE seule fois le renouvellement automatique, et
    // jamais sur l'appel /auth/refresh lui-même (éviterait une boucle).
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      }

      // Le renouvellement a échoué : session définitivement expirée.
      // AuthProvider redirige vers /login (voir lib/auth-context.tsx).
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }

    return Promise.reject(error);
  },
);
