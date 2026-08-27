import { Injectable, Logger } from '@nestjs/common';

export interface DevOutboxEntry {
  to: string;
  subject: string;
  resetToken?: string;
  invitationToken?: string;
  resetUrl?: string;
  invitationUrl?: string;
  sentAt: Date;
}

/**
 * Abstraction d'envoi d'email. Aucun fournisseur réel (SES, SendGrid,
 * Mailgun...) n'est branché à ce stade du projet — volontairement :
 * l'Étape 4 porte sur l'authentification, pas sur l'infrastructure
 * d'emailing.
 *
 * IMPORTANT — séparation stricte dev / production :
 *   - En développement/test, le contenu de l'email (dont le token de
 *     réinitialisation) est stocké dans une "boîte de sortie" interne
 *     en mémoire (`devOutbox`), JAMAIS via `Logger` — les logs
 *     applicatifs (console, fichiers de log, agrégateurs) ne doivent
 *     jamais contenir de secret. `devOutbox` n'est lu que par les tests
 *     et par l'endpoint de debug ci-dessous.
 *   - En production, `sendPasswordResetEmail` lève une exception
 *     explicite plutôt que de simuler silencieusement un envoi : mieux
 *     vaut un échec bruyant et visible qu'un utilisateur croyant avoir
 *     reçu un email qui n'a jamais été envoyé. Le jour où un fournisseur
 *     réel est branché, il suffit de remplacer le corps de cette
 *     méthode — aucun appelant (AuthService) n'a besoin de changer.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly devOutbox: DevOutboxEntry[] = [];

  async sendPasswordResetEmail(to: string, resetToken: string, resetUrl: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      // Échec volontairement bruyant : aucun fournisseur email réel
      // n'est configuré. Ne jamais remplacer ceci par un simple `return`
      // silencieux — cela ferait croire à l'utilisateur qu'un email a
      // été envoyé alors que ce n'est pas le cas.
      throw new Error(
        'MailService: aucun fournisseur email réel configuré pour la production. ' +
          'Implémentez sendPasswordResetEmail() avec un provider réel avant le déploiement.',
      );
    }

    // Développement/test uniquement : jamais via this.logger (pas de
    // secret dans les logs applicatifs).
    this.devOutbox.push({ to, subject: 'Réinitialisation de votre mot de passe', resetToken, resetUrl, sentAt: new Date() });
    this.logger.log(`[DEV] Email de réinitialisation "envoyé" à ${to} (contenu disponible via getDevOutbox(), jamais loggé ici).`);
  }

  /** Réservé au développement/tests — jamais exposé publiquement en production. */
  getDevOutbox(): ReadonlyArray<DevOutboxEntry> {
    return this.devOutbox;
  }

  async sendCompanyInvitationEmail(to: string, invitationToken: string, invitationUrl: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MailService: aucun fournisseur email réel configuré pour la production. ' +
          'Implémentez sendCompanyInvitationEmail() avec un provider réel avant le déploiement.',
      );
    }

    // Développement/test uniquement — jamais via this.logger (le token
    // d'invitation ne doit jamais apparaître dans les logs applicatifs).
    this.devOutbox.push({
      to,
      subject: 'Invitation à rejoindre une entreprise',
      invitationToken,
      invitationUrl,
      sentAt: new Date(),
    });
    this.logger.log(`[DEV] Email d'invitation "envoyé" à ${to} (contenu disponible via getDevOutbox(), jamais loggé ici).`);
  }

  clearDevOutbox(): void {
    this.devOutbox.length = 0;
  }
}
