'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

export default function EditSupplierPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentTermDays, setPaymentTermDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/suppliers/${params.id}`).then(({ data }) => {
        setName(data.name);
        setEmail(data.email ?? '');
        setPhone(data.phone ?? '');
        setPaymentTermDays(data.paymentTermDays);
        setLoaded(true);
      });
    }
  }, [authLoading, isAuthenticated, currentCompanyId, params.id, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiClient.patch(`/companies/${currentCompanyId}/suppliers/${params.id}`, { name, email: email || undefined, phone: phone || undefined, paymentTermDays });
      router.push(`/suppliers/${params.id}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (!loaded) return <main style={{ maxWidth: 600, margin: '4rem auto' }}>Chargement…</main>;

  return (
    <main style={{ maxWidth: 600, margin: '4rem auto' }}>
      <h1>Modifier le fournisseur</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Nom</label>
          <br />
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <br />
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="phone">Téléphone</label>
          <br />
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="paymentTermDays">Délai de paiement (jours)</label>
          <br />
          <input id="paymentTermDays" type="number" min={0} max={365} value={paymentTermDays} onChange={(e) => setPaymentTermDays(Number(e.target.value))} />
        </div>
        <button type="submit" disabled={isSaving} style={{ marginTop: '1rem' }}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
      <p>
        <a href={`/suppliers/${params.id}`}>Annuler</a>
      </p>
    </main>
  );
}
