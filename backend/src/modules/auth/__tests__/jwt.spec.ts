import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../jwt-payload.interface';

describe('JWT access token', () => {
  const secret = 'test_secret_at_least_32_characters_long';
  const jwtService = new JwtService({ secret, signOptions: { expiresIn: '15m' } });

  it('signe un token dont le payload décodé ne contient que sub et email', () => {
    const payload: JwtPayload = { sub: 'user-123', email: 'test@example.com' };
    const token = jwtService.sign(payload);
    const decoded = jwtService.decode(token) as Record<string, unknown>;

    expect(decoded.sub).toBe('user-123');
    expect(decoded.email).toBe('test@example.com');
    // Seuls sub/email/iat/exp doivent être présents — pas de rôle, pas
    // de liste de permissions, pas de liste d'entreprises.
    const keys = Object.keys(decoded).sort();
    expect(keys).toEqual(['email', 'exp', 'iat', 'sub']);
  });

  it('vérifie un token valide sans lever d\'exception', () => {
    const token = jwtService.sign({ sub: 'user-123', email: 'test@example.com' });
    expect(() => jwtService.verify(token)).not.toThrow();
  });

  it('rejette un token expiré', () => {
    const shortLivedJwt = new JwtService({ secret, signOptions: { expiresIn: '1ms' } });
    const token = shortLivedJwt.sign({ sub: 'user-123', email: 'test@example.com' });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => jwtService.verify(token)).toThrow();
        resolve();
      }, 50);
    });
  });

  it('rejette un token signé avec un secret différent', () => {
    const otherService = new JwtService({ secret: 'un_tout_autre_secret_32_caracteres' });
    const token = otherService.sign({ sub: 'user-123', email: 'test@example.com' });
    expect(() => jwtService.verify(token)).toThrow();
  });

  it('rejette un token malformé', () => {
    expect(() => jwtService.verify('ceci.nest.pas.un.jwt')).toThrow();
  });
});
