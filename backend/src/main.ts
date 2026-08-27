import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Audit pré-production : aucune vérification n'empêchait auparavant
  // le démarrage en production avec le secret JWT par défaut fourni
  // dans .env.example ("change_me_..."), ou un secret trop court —
  // n'importe qui connaissant ce placeholder aurait pu forger des
  // jetons valides. Refus de démarrage explicite, uniquement en
  // production (le développement local garde le placeholder pour
  // rester simple à installer).
  if (process.env.NODE_ENV === 'production') {
    const dangerousDefaults = ['change_me_access_secret_min_32_chars', 'change_me_refresh_secret_min_32_chars'];
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const value = process.env[name];
      if (!value || value.length < 32 || dangerousDefaults.includes(value)) {
        logger.error(`${name} manquant, trop court (<32 caractères) ou laissé à sa valeur par défaut — démarrage refusé en production.`);
        process.exit(1);
      }
    }
  }

  // Sécurité HTTP de base
  app.use(helmet());

  // Nécessaire pour lire le cookie HttpOnly du refresh token
  // (req.cookies.refresh_token) — voir auth.controller.ts.
  app.use(cookieParser());

  // CORS restreint au frontend. `credentials: true` est OBLIGATOIRE
  // pour que le navigateur envoie/accepte le cookie HttpOnly du refresh
  // token lors des requêtes cross-origin (front sur :3000, API sur :3001).
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  // Préfixe global de l'API — /health en est explicitement exclu :
  // un chemin fixe et prévisible pour les sondes d'infrastructure
  // (load balancer, orchestrateur), qui ne doivent pas dépendre de
  // API_PREFIX pour trouver le health check.
  const apiPrefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(apiPrefix, { exclude: ['health'] });

  // Validation globale des DTO (protection contre les entrées invalides)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime les champs non attendus (protection injection)
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`API démarrée sur http://localhost:${port}/${apiPrefix}`);
  logger.log(`Health check disponible sur http://localhost:${port}/health`);
  // Résumé de démarrage utile à l'exploitation — jamais de secret
  // (JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/DATABASE_URL ne sont jamais
  // journalisés, y compris partiellement).
  logger.log(`Environnement : ${process.env.NODE_ENV ?? 'development'} | CORS : ${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}`);
}

bootstrap();
