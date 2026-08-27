'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';

interface Company {
  id: string;
  name: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  taxIdNumber?: string | null;
  country: string;
  currency: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  status: string;
}

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!isAuthenticated) return;

    apiClient
      .get<Company>(`/companies/${params.id}`)
      .then(({ data }) => setCompany(data))
      .catch((err: AxiosError) => {
        if (err.response?.status === 403 || err.response?.status === 404) {
          setForbidden(true);
        } else {
          setError('Impossible de charger cette entreprise.');
        }
      });
  }, [authLoading, isAuthenticated, params.id, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.patch<Company>(`/companies/${params.id}`, {
        name: company.name,
        legalName: company.legalName || undefined,
        registrationNumber: company.registrationNumber || undefined,
        taxIdNumber: company.taxIdNumber || undefined,
        address: company.address || undefined,
        phone: company.phone || undefined,
        email: company.email || undefined,
      });
      setCompany(data);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 403) {
        setError('Vous n\'avez pas la permission de modifier cette entreprise (COMPANY.UPDATE requis).');
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (forbidden) {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h1>Accès refusé</h1>
        <p>Vous n&apos;avez pas accès à cette entreprise.</p>
        <p>
          <a href="/companies">Retour à mes entreprises</a>
        </p>
      </main>
    );
  }

  if (!company) {
    return <main style={{ maxWidth: 480, margin: '4rem auto' }}>Chargement…</main>;
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>{company.name}</h1>
      <p>
        <a href={`/companies/${params.id}/members`}>Gérer les membres</a>
      </p>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Raison sociale</label>
          <input id="name" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="registrationNumber">RCCM</label>
          <input
            id="registrationNumber"
            value={company.registrationNumber ?? ''}
            onChange={(e) => setCompany({ ...company, registrationNumber: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="taxIdNumber">IFU</label>
          <input id="taxIdNumber" value={company.taxIdNumber ?? ''} onChange={(e) => setCompany({ ...company, taxIdNumber: e.target.value })} />
        </div>
        <div>
          <label htmlFor="address">Adresse</label>
          <input id="address" value={company.address ?? ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
        </div>
        <div>
          <label htmlFor="phone">Téléphone</label>
          <input id="phone" value={company.phone ?? ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={company.email ?? ''} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isSaving}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
      <p>
        <a href="/companies">Retour à mes entreprises</a>
      </p>
    </main>
  );
}
