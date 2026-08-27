import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Applique la stratégie `jwt` (voir strategies/jwt.strategy.ts).
 * Usage : `@UseGuards(JwtAuthGuard)` sur un contrôleur ou une route.
 *
 * Choix volontaire : le guard n'est PAS appliqué globalement (pas de
 * `APP_GUARD` + décorateur `@Public()`). À ce stade du projet, seules
 * quelques routes existent (`auth`) et la majorité seront publiques
 * (register, login, refresh, forgot/reset-password) — l'appliquer route
 * par route est plus lisible ici. À revoir en Étape 5 si le nombre de
 * modules/routes protégées grandit.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
