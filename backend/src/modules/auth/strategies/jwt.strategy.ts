import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../jwt-payload.interface';

/**
 * Extrait l'access token du header `Authorization: Bearer <token>`.
 * L'access token n'est jamais lu depuis un cookie : voir la discussion
 * sur la stratégie de stockage dans auth.controller.ts / le README.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  /**
   * Appelé par Passport une fois la signature ET l'expiration du JWT
   * validées. On revérifie ici que l'utilisateur existe toujours et est
   * ACTIVE — un utilisateur suspendu après émission d'un access token
   * ne doit pas pouvoir continuer à l'utiliser jusqu'à son expiration
   * naturelle (jusqu'à 15 minutes plus tard sinon).
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session invalide.');
    }

    // Ce qui est retourné ici devient `request.user` — on ne renvoie
    // jamais passwordHash. `isSuperAdmin` est inclus pour que
    // PermissionsGuard puisse court-circuiter la vérification par
    // entreprise SANS requête supplémentaire — voir common/guards/permissions.guard.ts.
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin,
    };
  }
}
