import { hashPassword, verifyPassword } from '../password.util';

describe('password.util', () => {
  it('produit un hash au format argon2id', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('vérifie correctement un mot de passe valide', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    await expect(verifyPassword(hash, 'MonMotDePasse123!')).resolves.toBe(true);
  });

  it('rejette un mot de passe incorrect', async () => {
    const hash = await hashPassword('MonMotDePasse123!');
    await expect(verifyPassword(hash, 'MauvaisMotDePasse!')).resolves.toBe(false);
  });

  it('ne lève jamais d\'exception sur un hash malformé (retourne false)', async () => {
    await expect(verifyPassword('pas-un-hash-argon2', 'peu importe')).resolves.toBe(false);
  });

  it('deux hashs du même mot de passe sont différents (sel aléatoire)', async () => {
    const hash1 = await hashPassword('MemeMotDePasse123!');
    const hash2 = await hashPassword('MemeMotDePasse123!');
    expect(hash1).not.toBe(hash2);
  });

  it('ne stocke jamais le mot de passe en clair dans le hash', async () => {
    const plain = 'MotDePasseSecret123!';
    const hash = await hashPassword(plain);
    expect(hash).not.toContain(plain);
  });
});
