'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../../lib/api-client';
import { useCompany } from '../../../lib/company-context';

export default function NewCompanyPage() {
  const router = useRouter();
  const { refreshCompanies, setCurrentCompanyId } = useCompany();

  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [taxIdNumber, setTaxIdNumber] = useState('');
  const [country, setCountry] = useState('BJ');
  const [currency, setCurrency] = useState('XOF');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await apiClient.post('/companies', {
        name,
        registrationNumber: registrationNumber || undefined,
        taxIdNumber: taxIdNumber || undefined,
        country,
        currency,
        address: address || undefined,
        phone: phone || undefined,
        email: email || undefined,
      });
      await refreshCompanies();
      setCurrentCompanyId(data.company.id);
      router.push(`/companies/${data.company.id}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 400) {
        setError('Certains champs sont invalides. Vérifiez le formulaire.');
      } else {
        setError('Une erreur est survenue. Merci de réessayer.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>Créer une entreprise</h1>
      <p>Vous en deviendrez automatiquement l&apos;administrateur (rôle ADMIN).</p>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Raison sociale *</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} />
        </div>
        <div>
          <label htmlFor="country">Pays (code ISO 2 lettres) *</label>
          <input id="country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} required minLength={2} maxLength={2} />
        </div>
        <div>
          <label htmlFor="currency">Devise</label>
          <input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
        </div>
        <div>
          <label htmlFor="registrationNumber">RCCM</label>
          <input id="registrationNumber" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
        </div>
        <div>
          <label htmlFor="taxIdNumber">IFU</label>
          <input id="taxIdNumber" value={taxIdNumber} onChange={(e) => setTaxIdNumber(e.target.value)} />
        </div>
        <div>
          <label htmlFor="address">Adresse</label>
          <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label htmlFor="phone">Téléphone</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Création…' : 'Créer l\'entreprise'}
        </button>
      </form>
      <p>
        <a href="/companies">Annuler</a>
      </p>
    </main>
  );
}
