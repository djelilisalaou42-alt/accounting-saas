import * as argon2 from 'argon2';

/**
 * Argon2id : recommandé par l'OWASP pour le hachage de mots de passe
 * (résistant aux attaques GPU/ASIC et aux attaques par canal auxiliaire,
 * contrairement à Argon2i/Argon2d pris isolément). Paramètres calibrés
 * pour un serveur web classique (~50-100ms par hash) :
 *   - memoryCost: 19456 KiB (~19 Mo) — recommandation OWASP 2023
 *   - timeCost: 2 itérations
 *   - parallelism: 1
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    // Hash malformé/algorithme inconnu : traiter comme un échec de
    // vérification plutôt que de laisser remonter une exception.
    return false;
  }
}
