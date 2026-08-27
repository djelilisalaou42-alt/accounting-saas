'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { apiClient } from './api-client';
import { useAuth } from './auth-context';

export interface CompanyMembership {
  companyId: string;
  companyName: string;
  companyStatus: string;
  roleName: string;
  isDefault: boolean;
}

interface CompanyContextValue {
  companies: CompanyMembership[];
  currentCompanyId: string | null;
  isLoading: boolean;
  setCurrentCompanyId: (companyId: string) => void;
  switchCompany: (companyId: string) => Promise<void>;
  refreshCompanies: () => Promise<void>;
}

const CURRENT_COMPANY_STORAGE_KEY = 'accounting-saas:current-company-id';

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);

/**
 * IMPORTANT : `currentCompanyId` est une simple PRÉFÉRENCE D'AFFICHAGE
 * côté client (persistée en localStorage pour le confort — ce n'est PAS
 * un secret, juste "quelle entreprise afficher au prochain chargement").
 * Ce n'est en AUCUN CAS une frontière de sécurité : chaque appel API
 * vers une route `/companies/:companyId/...` fait revérifier
 * l'appartenance par le backend (PermissionsGuard), qui ne fait jamais
 * confiance à un `companyId` fourni par le frontend sans le confronter
 * à la base — voir README.
 */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [currentCompanyId, setCurrentCompanyIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCompanies = useCallback(async () => {
    if (!isAuthenticated) {
      setCompanies([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { data } = await apiClient.get<CompanyMembership[]>('/companies');
      setCompanies(data);

      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(CURRENT_COMPANY_STORAGE_KEY) : null;
      const stillValid = stored && data.some((c) => c.companyId === stored);
      if (stillValid) {
        setCurrentCompanyIdState(stored);
      } else {
        const fallback = data.find((c) => c.isDefault)?.companyId ?? data[0]?.companyId ?? null;
        setCurrentCompanyIdState(fallback);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const setCurrentCompanyId = useCallback((companyId: string) => {
    setCurrentCompanyIdState(companyId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CURRENT_COMPANY_STORAGE_KEY, companyId);
    }
  }, []);

  const switchCompany = useCallback(
    async (companyId: string) => {
      // Confirme l'accès côté serveur (et journalise COMPANY_SWITCH) —
      // ne fait que le confirmer, ne pose aucun état serveur : voir
      // companies.service.ts / README.
      await apiClient.post(`/companies/${companyId}/switch`);
      setCurrentCompanyId(companyId);
    },
    [setCurrentCompanyId],
  );

  return (
    <CompanyContext.Provider
      value={{ companies, currentCompanyId, isLoading, setCurrentCompanyId, switchCompany, refreshCompanies }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error('useCompany doit être utilisé à l\'intérieur de <CompanyProvider>.');
  }
  return ctx;
}
