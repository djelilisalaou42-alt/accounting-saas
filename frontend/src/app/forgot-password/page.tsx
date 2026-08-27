'use client';

import { useState, FormEvent } from 'react';
import { apiClient } from '../../lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
    } finally {
      // Message affiché SYSTÉMATIQUEMENT, que l'email existe ou non —
      // reflète exactement ce que renvoie le backend (voir
      // auth.controller.ts / auth.service.ts) : ne jamais indiquer si
      // le compte existe.
      setIsSubmitting(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <main style={{ maxWidth: 400, margin: '4rem auto' }}>
        <h1>Vérifiez votre boîte mail</h1>
        <p>Si cette adresse existe, un email de réinitialisation a été envoyé.</p>
        <p>
          <a href="/login">Retour à la connexion</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto' }}>
      <h1>Mot de passe oublié</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Envoi…' : 'Envoyer le lien de réinitialisation'}
        </button>
      </form>
      <p>
        <a href="/login">Retour à la connexion</a>
      </p>
    </main>
  );
}
