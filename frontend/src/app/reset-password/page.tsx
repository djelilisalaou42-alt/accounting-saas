'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../lib/api-client';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      router.push('/login?reset=1');
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        setError('Ce lien de réinitialisation est invalide ou a expiré. Refaites une demande.');
      } else if (err instanceof AxiosError && err.response?.status === 400) {
        setError('Mot de passe trop faible : au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.');
      } else {
        setError('Une erreur est survenue. Merci de réessayer.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <main style={{ maxWidth: 400, margin: '4rem auto' }}>
        <h1>Lien invalide</h1>
        <p>Ce lien de réinitialisation est incomplet. Refaites une demande depuis la page « mot de passe oublié ».</p>
        <p>
          <a href="/forgot-password">Faire une nouvelle demande</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto' }}>
      <h1>Nouveau mot de passe</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="newPassword">Nouveau mot de passe</label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={10}
          />
          <small>Au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.</small>
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enregistrement…' : 'Réinitialiser le mot de passe'}
        </button>
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 400, margin: '4rem auto' }}>Chargement…</main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
