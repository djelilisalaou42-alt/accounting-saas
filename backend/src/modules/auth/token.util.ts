import { randomBytes, createHash } from 'crypto';

/**
 * Tokens opaques (refresh token, reset token) : générés côté serveur
 * avec crypto.randomBytes (aléatoire cryptographiquement sûr), envoyés
 * en clair au client UNE seule fois, mais jamais stockés en clair en
 * base — seul leur hash SHA-256 est persisté. Un vol de la base ne
 * permet donc pas de rejouer un token existant (SHA-256 est un hachage
 * rapide, volontairement : ces tokens ont une entropie de 256 bits,
 * contrairement à un mot de passe humain, un hachage lent type Argon2
 * n'apporte ici aucune protection supplémentaire et ne ferait que
 * ralentir chaque vérification de session).
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url'); // 256 bits d'entropie
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Parseur minimal de durées type "15m", "7d", "1h" -> millisecondes.
 * Volontairement restreint aux unités utilisées par ce projet (m/h/d)
 * plutôt que d'ajouter une dépendance externe pour un besoin aussi
 * simple.
 */
export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Format de durée invalide: "${duration}" (attendu ex: "15m", "7d")`);
  }
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * unitMs[match[2]];
}
