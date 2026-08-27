import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, RequestMetadata } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';

/**
 * =====================================================================
 * STRATÉGIE DE STOCKAGE DES TOKENS (voir aussi README.md)
 * =====================================================================
 *
 * ACCESS TOKEN : retourné dans le corps JSON de la réponse, jamais posé
 * en cookie. Le frontend le garde EN MÉMOIRE (state React / store côté
 * client), jamais dans localStorage ni sessionStorage. Justification :
 * un JWT en localStorage est lisible par n'importe quel script — donc
 * par une éventuelle faille XSS, qui pourrait alors l'exfiltrer et
 * usurper la session jusqu'à expiration. En le gardant uniquement en
 * mémoire JS (perdu au rechargement de page), la fenêtre d'exposition
 * en cas de XSS est limitée au code exécuté pendant cette session
 * précise, et la durée de vie courte du token (15 min) limite encore
 * la casse. La perte au rechargement est compensée par le refresh
 * silencieux au chargement de l'app (voir frontend).
 *
 * REFRESH TOKEN : posé en cookie HttpOnly + Secure + SameSite=Strict,
 * avec `path=/api/v1/auth` (jamais accessible à un autre endpoint que
 * ceux d'authentification). HttpOnly empêche tout accès depuis du
 * JavaScript (donc immunisé contre le vol par XSS, contrairement à un
 * stockage en localStorage). Secure impose HTTPS. SameSite=Strict
 * empêche le navigateur de l'envoyer sur une requête cross-site,
 * neutralisant le CSRF pour ce cookie précis SANS nécessiter de
 * token CSRF séparé — le compromis (SameSite=Strict empêche aussi
 * l'envoi depuis un lien externe menant vers le site) est acceptable
 * ici car /auth/refresh n'est jamais appelé depuis un lien, uniquement
 * par le code JS de l'application elle-même au chargement.
 * =====================================================================
 */

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000, // aligné sur JWT_REFRESH_EXPIRES_IN (7j par défaut)
  };
}

function extractMetadata(req: Request): RequestMetadata {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ips?.length ? req.ips[0] : req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ---------------------------------------------------------------------
  // POST /auth/register
  // ---------------------------------------------------------------------
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 inscriptions / minute / IP+email
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ---------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 tentatives / minute / IP+email
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.authService.login(dto, extractMetadata(req));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return { accessToken, user };
  }

  // ---------------------------------------------------------------------
  // POST /auth/refresh
  // ---------------------------------------------------------------------
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refreshToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Aucune session à renouveler.');
    }

    const { accessToken, refreshToken } = await this.authService.refresh(rawRefreshToken, extractMetadata(req));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return { accessToken };
  }

  // ---------------------------------------------------------------------
  // POST /auth/logout
  // ---------------------------------------------------------------------
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  // ---------------------------------------------------------------------
  // POST /auth/logout-all
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(user.id);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  // ---------------------------------------------------------------------
  // POST /auth/forgot-password
  // ---------------------------------------------------------------------
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // limite basse : évite le spam d'emails
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.forgotPassword(dto, extractMetadata(req));
    // Message strictement identique que l'email existe ou non.
    return { message: 'Si cette adresse existe, un email de réinitialisation a été envoyé.' };
  }

  // ---------------------------------------------------------------------
  // POST /auth/reset-password
  // ---------------------------------------------------------------------
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  // ---------------------------------------------------------------------
  // POST /auth/change-password
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'Mot de passe modifié. Toutes vos sessions ont été déconnectées.' };
  }

  // ---------------------------------------------------------------------
  // GET /auth/me
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
