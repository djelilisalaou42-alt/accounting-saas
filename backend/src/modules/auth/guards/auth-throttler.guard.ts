import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttling par ADRESSE IP + EMAIL soumis (pas seulement par IP) :
 * limite les tentatives de connexion sur un compte donné même si
 * l'attaquant fait tourner plusieurs IP (rotation de proxy), en plus de
 * la protection par IP déjà assurée par ThrottlerModule (config globale
 * dans app.module.ts). Ce guard est appliqué explicitement sur
 * /auth/login, /auth/register et /auth/forgot-password avec des limites
 * plus strictes que le reste de l'API (voir @Throttle sur chaque route).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown';
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return `${ip}:${email}`;
  }

  protected async shouldSkip(_context: ExecutionContext): Promise<boolean> {
    return false;
  }
}
