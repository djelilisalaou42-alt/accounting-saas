'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { AxiosError } from 'axios';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Redirection post-connexion : utilisée notamment par le flux
  // d'acceptation d'invitation (?redirect=/companies/invitations/TOKEN/accept).
  // Toujours dans l'URL, jamais en localStorage — voir README.
  const redirectTo = searchParams.get('redirect') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push(redirectTo);
    } catch (err) {
      // Message générique côté frontend aussi : ne jamais afficher un
      // détail qui distinguerait "email inconnu" de "mot de passe faux"
      // (le backend renvoie déjà un message générique, on ne l'enrichit
      // surtout pas ici).
      if (err instanceof AxiosError && err.response?.status === 429) {
        setError('Trop de tentatives. Réessayez dans quelques instants.');
      } else {
        setError('Email ou mot de passe incorrect.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto' }}>
      <h1>Connexion</h1>
      {redirectTo !== '/' && (
        <p style={{ color: '#555' }}>Connectez-vous pour continuer.</p>
      )}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p>
        <a href="/forgot-password">Mot de passe oublié ?</a>
      </p>
      <p>
        Pas encore de compte ?{' '}
        <a href={`/register${redirectTo !== '/' ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}`}>
          Créer un compte
        </a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 400, margin: '4rem auto' }}>Chargement…</main>}>
      <LoginForm />
    </Suspense>
  );
}
