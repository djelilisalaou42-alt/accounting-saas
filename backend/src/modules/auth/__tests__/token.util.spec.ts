import { generateOpaqueToken, hashOpaqueToken, parseDurationToMs } from '../token.util';
import { createHash } from 'crypto';

describe('token.util', () => {
  describe('generateOpaqueToken', () => {
    it('génère un token avec au moins 256 bits d\'entropie (32 octets bruts)', () => {
      const token = generateOpaqueToken();
      // base64url : 32 octets -> 43 caractères (sans padding)
      const decoded = Buffer.from(token, 'base64url');
      expect(decoded.length).toBe(32);
    });

    it('génère des tokens différents à chaque appel', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
      expect(tokens.size).toBe(100);
    });
  });

  describe('hashOpaqueToken', () => {
    it('produit un hash SHA-256 déterministe', () => {
      const token = 'token-de-test-fixe';
      const expected = createHash('sha256').update(token).digest('hex');
      expect(hashOpaqueToken(token)).toBe(expected);
      expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    });

    it('produit un hash différent pour des tokens différents', () => {
      expect(hashOpaqueToken('token-a')).not.toBe(hashOpaqueToken('token-b'));
    });

    it('le hash ne permet pas de retrouver le token original', () => {
      const token = generateOpaqueToken();
      const hash = hashOpaqueToken(token);
      expect(hash).not.toContain(token);
      expect(hash.length).toBe(64); // hex sha256 = 64 caractères
    });
  });

  describe('parseDurationToMs', () => {
    it.each([
      ['15m', 15 * 60_000],
      ['7d', 7 * 86_400_000],
      ['1h', 3_600_000],
      ['30s', 30_000],
    ])('parse "%s" en %i ms', (input, expected) => {
      expect(parseDurationToMs(input)).toBe(expected);
    });

    it('lève une erreur sur un format invalide', () => {
      expect(() => parseDurationToMs('abc')).toThrow();
      expect(() => parseDurationToMs('15')).toThrow();
      expect(() => parseDurationToMs('15y')).toThrow();
    });
  });
});
