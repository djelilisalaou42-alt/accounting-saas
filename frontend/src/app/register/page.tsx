'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../lib/api-client';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/register', { firstName, lastName, email, password });
      const loginUrl = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login?registered=1';
      router.push(loginUrl);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 409) {
        setError('Cette adresse email est déjà utilisée.');
      } else if (err instanceof AxiosError && err.response?.status === 400) {
        setError('Mot de passe trop faible : au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.');
      } else {
        setError('Une erreur est survenue. Merci de réessayer.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto' }}>
      <h1>Créer un compte</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="firstName">Prénom</label>
          <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="lastName">Nom</label>
          <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={10}
          />
          <small>Au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.</small>
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
      <p>
        Déjà un compte ?{' '}
        <a href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'}>Se connecter</a>
      </p>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 400, margin: '4rem auto' }}>Chargement…</main>}>
      <RegisterForm />
    </Suspense>
  );
}
