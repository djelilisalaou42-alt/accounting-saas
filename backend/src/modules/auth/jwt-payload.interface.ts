/**
 * Payload minimal du JWT d'accès — volontairement réduit à `sub`
 * (identifiant utilisateur) et `email`. Aucune permission, aucun rôle,
 * aucune liste d'entreprises : ces informations changent plus souvent
 * que la durée de vie d'un token et doivent être résolues à la demande
 * (Étape 5) plutôt que figées dans un JWT non révocable individuellement.
 */
export interface JwtPayload {
  sub: string;
  email: string;
}
