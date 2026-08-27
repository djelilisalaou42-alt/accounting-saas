import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { hashPassword, verifyPassword } from './password.util';
import { generateOpaqueToken, hashOpaqueToken, parseDurationToMs } from './token.util';
import { JwtPayload } from './jwt-payload.interface';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
}

const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5);
const LOGIN_LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
const RESET_TOKEN_TTL_MINUTES = 30;

/** Message générique renvoyé pour TOUT échec de connexion — ne jamais
 * révéler si c'est l'email ou le mot de passe qui est en cause, ni si
 * le compte existe. */
const GENERIC_LOGIN_ERROR = 'Email ou mot de passe incorrect.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  // =====================================================================
  // INSCRIPTION
  // =====================================================================

  async register(dto: RegisterDto): Promise<PublicUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Cette adresse email est déjà utilisée.');
    }

    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        status: 'ACTIVE',
      },
    });

    await this.audit('REGISTER', user.id, 'User', user.id, null, { email: user.email });

    return this.toPublicUser(user);
  }

  // =====================================================================
  // CONNEXION
  // =====================================================================

  async login(
    dto: LoginDto,
    meta: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        dto.password,
      );
      await this.audit('LOGIN_FAILED', null, 'User', null, null, { email: dto.email, reason: 'unknown_email' }, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit('LOGIN_FAILED', user.id, 'User', user.id, null, { reason: 'locked' }, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.status !== 'ACTIVE') {
      await this.audit('LOGIN_FAILED', user.id, 'User', user.id, null, { reason: 'inactive_status' }, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordValid = await verifyPassword(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount);
      await this.audit('LOGIN_FAILED', user.id, 'User', user.id, null, { reason: 'bad_password' }, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: meta.ipAddress,
      },
    });

    const { accessToken, refreshToken } = await this.issueTokenPair(user.id, user.email, meta);

    await this.audit('LOGIN', user.id, 'User', user.id, null, null, meta);

    return { accessToken, refreshToken, user: this.toPublicUser(user) };
  }

  private async registerFailedAttempt(userId: string, currentCount: number): Promise<void> {
    const newCount = currentCount + 1;
    const shouldLock = newCount >= MAX_LOGIN_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: newCount,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000)
          : undefined,
      },
    });
  }

  // =====================================================================
  // ACCESS + REFRESH TOKEN
  // =====================================================================

  private async issueTokenPair(
    userId: string,
    email: string,
    meta: RequestMetadata,
    replacesTokenId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = this.jwtService.sign(payload);

    const rawRefreshToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + parseDurationToMs(REFRESH_TOKEN_TTL));

    const created = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    if (replacesTokenId) {
      await this.prisma.refreshToken.update({
        where: { id: replacesTokenId },
        data: { replacedByTokenId: created.id },
      });
    }

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async refresh(
    rawRefreshToken: string,
    meta: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new UnauthorizedException('Session invalide.');
    }

    if (existing.revoked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
      await this.audit(
        'REVOKE',
        existing.userId,
        'RefreshToken',
        existing.id,
        null,
        { reason: 'reuse_detected' },
        meta,
      );
      this.logger.warn(`Réutilisation de refresh token détectée pour user=${existing.userId} — toutes les sessions révoquées.`);
      throw new UnauthorizedException('Session invalide.');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session invalide.');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, revokedAt: new Date(), lastUsedAt: new Date() },
    });

    const tokens = await this.issueTokenPair(user.id, user.email, meta, existing.id);
    await this.audit('REFRESH', user.id, 'RefreshToken', existing.id, null, null, meta);
    return tokens;
  }

  // =====================================================================
  // DÉCONNEXION
  // =====================================================================

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revoked) {
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, revokedAt: new Date() },
    });

    await this.audit('LOGOUT', existing.userId, 'RefreshToken', existing.id, null, null);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });

    await this.audit('LOGOUT_ALL', userId, 'User', userId, null, { scope: 'all_sessions' });
  }

  // =====================================================================
  // MOT DE PASSE OUBLIÉ / RÉINITIALISATION
  // =====================================================================

  async forgotPassword(dto: ForgotPasswordDto, meta: RequestMetadata): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress,
      },
    });

    await this.audit('PASSWORD_RESET_REQUEST', user.id, 'PasswordResetToken', null, null, null, meta);

    // Le token BRUT ne transite que par MailService (jamais par
    // this.logger) — voir mail.service.ts pour la séparation stricte
    // dev/production.
    const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, rawToken, resetUrl);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashOpaqueToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Lien de réinitialisation invalide ou expiré.');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
    ]);

    await this.audit('PASSWORD_RESET', resetToken.userId, 'User', resetToken.userId, null, { action: 'password_reset' });
  }

  // =====================================================================
  // CHANGEMENT DE MOT DE PASSE (utilisateur connecté)
  // =====================================================================

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const oldPasswordValid = await verifyPassword(user.passwordHash, dto.oldPassword);
    if (!oldPasswordValid) {
      throw new UnauthorizedException('Ancien mot de passe incorrect.');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      }),
    ]);

    await this.audit('PASSWORD_CHANGE', userId, 'User', userId, null, { action: 'password_change' });
  }

  // =====================================================================
  // PROFIL
  // =====================================================================

  toPublicUser(user: { id: string; email: string; firstName: string; lastName: string; status: string }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    };
  }

  // =====================================================================
  // AUDIT
  // =====================================================================

  private async audit(
    action: string,
    userId: string | null,
    entityType: string,
    entityId: string | null,
    oldValue: unknown,
    newValue: unknown,
    meta?: RequestMetadata,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: action as any,
          entityType,
          entityId,
          oldValue: oldValue as any,
          newValue: newValue as any,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(`Échec de journalisation d'audit (${action}/${entityType}): ${(err as Error).message}`);
    }
  }
}
