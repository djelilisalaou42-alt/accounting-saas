import { Controller, Get, HttpCode, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * =====================================================================
 * Finalisation pré-production — endpoint de santé.
 *
 * Volontairement SANS guard (ni JwtAuthGuard, ni PermissionsGuard) :
 * un load balancer / orchestrateur (Kubernetes, Docker healthcheck,
 * etc.) qui sonde cet endpoint n'a ni compte utilisateur ni jeton —
 * exiger une authentification rendrait le health check inutilisable
 * par l'infrastructure. Exposé HORS du préfixe /api/v1 (voir main.ts)
 * pour rester à un chemin fixe et prévisible : GET /health.
 *
 * Ne renvoie STRICTEMENT que le nécessaire pour déterminer si
 * l'application est opérationnelle — jamais de secret, de jeton, de
 * détail de configuration, de stack trace, ni de message d'erreur brut
 * de la base de données (qui pourrait révéler la structure interne).
 * =====================================================================
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    let databaseStatus: 'ok' | 'error' = 'ok';
    try {
      // Requête la plus légère possible — vérifie uniquement que la
      // connexion PostgreSQL répond, jamais une agrégation coûteuse.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      databaseStatus = 'error';
      // Le message d'erreur brut (potentiellement une adresse de
      // connexion ou un détail SQL) reste côté serveur uniquement,
      // jamais renvoyé au client.
      this.logger.error('Health check : échec de connexion à la base de données.', error instanceof Error ? error.stack : undefined);
    }

    const body = {
      status: databaseStatus === 'ok' ? 'ok' : 'error',
      database: databaseStatus,
      timestamp: new Date().toISOString(),
    };

    if (databaseStatus === 'error') {
      // 503 explicite pour que les sondes d'infrastructure (liveness/
      // readiness) détectent correctement l'indisponibilité, plutôt
      // qu'un 200 avec un corps "error" ignoré par un check HTTP basique.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
