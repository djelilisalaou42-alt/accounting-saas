import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Service Prisma unique, injecté dans tous les modules.
 * Centralise la connexion à PostgreSQL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connexion à la base de données établie');
    } catch (error) {
      // Erreur critique au démarrage — journalisée clairement côté
      // serveur (jamais renvoyée à un client, cette méthode ne sert
      // aucune requête HTTP) avant de laisser Nest interrompre le
      // démarrage : mieux vaut un échec explicite et lisible qu'un
      // crash silencieux difficile à diagnostiquer en production.
      this.logger.error('Échec de connexion à la base de données au démarrage.', error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
