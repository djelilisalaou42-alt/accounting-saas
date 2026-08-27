'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../../../../lib/api-client';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';

interface InvitationPreview {
  companyName: string;
  email: string;
  roleName: string;
  status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'already_used' }
  | { kind: 'ready'; preview: InvitationPreview }
  | { kind: 'accepting' }
  | { kind: 'error'; message: string };

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { refreshCompanies, setCurrentCompanyId } = useCompany();

  const [state, setState] = useState<ViewState>({ kind: 'loading' });

  // Le token ne vit QUE dans l'URL (params.token) — jamais copié en
  // localStorage/sessionStorage. La redirection vers /login (si
  // nécessaire) le conserve simplement dans le paramètre `redirect`
  // de l'URL de connexion, jamais ailleurs.
  useEffect(() => {
    if (authLoading) return;

    apiClient
      .get<InvitationPreview>(`/companies/invitations/${params.token}`)
      .then(({ data }) => {
        if (data.status === 'EXPIRED') {
          setState({ kind: 'expired' });
        } else if (data.status === 'ACCEPTED' || data.status === 'REVOKED') {
          setState({ kind: 'already_used' });
        } else {
          setState({ kind: 'ready', preview: data });
        }
      })
      .catch((err: AxiosError) => {
        if (err.response?.status === 404) {
          setState({ kind: 'not_found' });
        } else {
          setState({ kind: 'error', message: 'Une erreur est survenue lors de la vérification de l\'invitation.' });
        }
      });
  }, [authLoading, params.token]);

  // Si l'invitation est valide mais l'utilisateur n'est pas connecté,
  // on le redirige vers /login en conservant le chemin de retour dans
  // l'URL (paramètre `redirect`), pour revenir automatiquement ici
  // après connexion — jamais via un stockage navigateur.
  useEffect(() => {
    if (state.kind === 'ready' && !authLoading && !isAuthenticated) {
      const returnTo = `/companies/invitations/${params.token}/accept`;
      router.push(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
  }, [state.kind, authLoading, isAuthenticated, params.token, router]);

  async function handleAccept() {
    setState({ kind: 'accepting' });
    try {
      const { data } = await apiClient.post<{ companyId: string; userCompanyId: string }>(
        `/companies/invitations/${params.token}/accept`,
      );
      await refreshCompanies();
      setCurrentCompanyId(data.companyId);
      router.push(`/companies/${data.companyId}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 403) {
        setState({ kind: 'error', message: 'Cette invitation ne correspond pas à votre compte connecté.' });
      } else if (err instanceof AxiosError && err.response?.status === 401) {
        setState({ kind: 'already_used' });
      } else {
        setState({ kind: 'error', message: 'Une erreur est survenue lors de l\'acceptation.' });
      }
    }
  }

  if (state.kind === 'loading' || authLoading) {
    return <main style={{ maxWidth: 480, margin: '4rem auto' }}>Vérification de l&apos;invitation…</main>;
  }

  if (state.kind === 'not_found') {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h1>Invitation introuvable</h1>
        <p>Ce lien d&apos;invitation n&apos;est pas valide.</p>
        <p>
          <a href="/login">Retour à la connexion</a>
        </p>
      </main>
    );
  }

  if (state.kind === 'expired') {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h1>Invitation expirée</h1>
        <p>Cette invitation a expiré.</p>
        <p>Demandez à l&apos;administrateur de l&apos;entreprise de vous envoyer une nouvelle invitation.</p>
        <p>
          <a href="/login">Retour à la connexion</a>
        </p>
      </main>
    );
  }

  if (state.kind === 'already_used') {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h1>Invitation déjà utilisée</h1>
        <p>Cette invitation a déjà été utilisée.</p>
        <p>
          <a href="/login">Se connecter</a>
        </p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main style={{ maxWidth: 480, margin: '4rem auto' }}>
        <h1>Erreur</h1>
        <p role="alert">{state.message}</p>
        <p>
          <a href="/login">Retour à la connexion</a>
        </p>
      </main>
    );
  }

  // state.kind === 'ready' | 'accepting'
  const preview = state.kind === 'ready' ? state.preview : (state as { preview?: InvitationPreview }).preview;

  if (!isAuthenticated) {
    // Redirection vers /login en cours (effect ci-dessus) — rien à afficher.
    return <main style={{ maxWidth: 480, margin: '4rem auto' }}>Redirection…</main>;
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>Invitation à rejoindre une entreprise</h1>
      {preview && (
        <>
          <p>
            <strong>{preview.companyName}</strong> vous invite à rejoindre son espace comptable.
          </p>
          <ul>
            <li>Email invité : {preview.email}</li>
            <li>Rôle proposé : {preview.roleName}</li>
          </ul>
        </>
      )}
      {user && preview && user.email.toLowerCase() !== preview.email.toLowerCase() && (
        <p style={{ color: '#a15c00' }}>
          Attention : cette invitation a été envoyée à {preview.email}, mais vous êtes connecté avec{' '}
          {user.email}. L&apos;acceptation sera refusée si les emails ne correspondent pas.
        </p>
      )}
      <button onClick={handleAccept} disabled={state.kind === 'accepting'}>
        {state.kind === 'accepting' ? 'Acceptation…' : "Accepter l'invitation"}
      </button>
    </main>
  );
}
