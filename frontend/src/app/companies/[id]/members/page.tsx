'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { apiClient } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';

interface Member {
  userCompanyId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED' | 'REMOVED';
  isDefault: boolean;
}

const ASSIGNABLE_ROLES = ['ADMIN', 'DIRECTOR', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT', 'AUDITOR', 'VIEWER'];

export default function CompanyMembersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [members, setMembers] = useState<Member[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('VIEWER');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  async function loadMembers() {
    try {
      const { data } = await apiClient.get<Member[]>(`/companies/${params.id}/members`);
      setMembers(data);
    } catch (err) {
      if (err instanceof AxiosError && (err.response?.status === 403 || err.response?.status === 404)) {
        setForbidden(true);
      } else {
        setError('Impossible de charger les membres.');
      }
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated) loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, params.id]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setIsInviting(true);
    setInviteMessage(null);
    try {
      await apiClient.post(`/companies/${params.id}/members/invite`, { email: inviteEmail, roleName: inviteRole });
      setInviteMessage(`Invitation envoyée à ${inviteEmail}.`);
      setInviteEmail('');
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 409) {
        setInviteMessage('Cet utilisateur est déjà membre actif.');
      } else if (err instanceof AxiosError && err.response?.status === 403) {
        setInviteMessage('Vous n\'avez pas la permission d\'inviter des membres (USER.CREATE requis).');
      } else {
        setInviteMessage('Une erreur est survenue.');
      }
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRoleChange(userCompanyId: string, roleName: string) {
    await apiClient.patch(`/companies/${params.id}/members/${userCompanyId}/role`, { roleName });
    loadMembers();
  }

  async function handleDisable(userCompanyId: string) {
    await apiClient.post(`/companies/${params.id}/members/${userCompanyId}/disable`);
    loadMembers();
  }

  async function handleEnable(userCompanyId: string) {
    await apiClient.post(`/companies/${params.id}/members/${userCompanyId}/enable`);
    loadMembers();
  }

  async function handleRemove(userCompanyId: string) {
    if (!window.confirm('Retirer ce membre de l\'entreprise ?')) return;
    await apiClient.delete(`/companies/${params.id}/members/${userCompanyId}`);
    loadMembers();
  }

  if (forbidden) {
    return (
      <main style={{ maxWidth: 600, margin: '4rem auto' }}>
        <h1>Accès refusé</h1>
        <p>Vous n&apos;avez pas la permission de consulter les membres de cette entreprise (USER.READ requis).</p>
        <p>
          <a href="/companies">Retour à mes entreprises</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>Membres de l&apos;entreprise</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {members === null ? (
        <p>Chargement…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Nom</th>
              <th align="left">Email</th>
              <th align="left">Rôle</th>
              <th align="left">Statut</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userCompanyId}>
                <td>
                  {m.firstName} {m.lastName}
                </td>
                <td>{m.email}</td>
                <td>
                  <select value={m.roleName} onChange={(e) => handleRoleChange(m.userCompanyId, e.target.value)}>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{m.status}</td>
                <td>
                  {m.status === 'ACTIVE' && <button onClick={() => handleDisable(m.userCompanyId)}>Désactiver</button>}
                  {m.status === 'DISABLED' && <button onClick={() => handleEnable(m.userCompanyId)}>Réactiver</button>}
                  {m.status !== 'REMOVED' && <button onClick={() => handleRemove(m.userCompanyId)}>Retirer</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Inviter un membre</h2>
      <form onSubmit={handleInvite}>
        <div>
          <label htmlFor="inviteEmail">Email</label>
          <input id="inviteEmail" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="inviteRole">Rôle</label>
          <select id="inviteRole" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={isInviting}>
          {isInviting ? 'Envoi…' : 'Envoyer l\'invitation'}
        </button>
      </form>
      {inviteMessage && <p>{inviteMessage}</p>}

      <p>
        <a href={`/companies/${params.id}`}>Retour à l&apos;entreprise</a>
      </p>
    </main>
  );
}
