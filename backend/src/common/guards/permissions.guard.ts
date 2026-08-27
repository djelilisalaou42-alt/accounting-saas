import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Vérifie, dans cet ordre, exactement les 5 points demandés :
 *   1. utilisateur authentifié (délégué à JwtAuthGuard, exécuté avant —
 *      ce guard suppose que `request.user` est déjà peuplé) ;
 *   2. entreprise active (`Company.status === 'ACTIVE'`) ;
 *   3. appartenance de l'utilisateur à l'entreprise (`UserCompany`
 *      existe ET `status === 'ACTIVE'` — un membre désactivé ou retiré
 *      est traité comme n'appartenant plus à l'entreprise) ;
 *   4. rôle dans CETTE entreprise précise (jamais un rôle d'une autre
 *      entreprise à laquelle l'utilisateur appartiendrait aussi) ;
 *   5. permission(s) requise(s), déclarée(s) via `@RequirePermissions`.
 *
 * SÉCURITÉ CENTRALE : le `companyId` est TOUJOURS lu depuis le paramètre
 * de route (`req.params.companyId`), jamais depuis le body ou une
 * variable de session. Chaque requête est revérifiée intégralement —
 * aucun état "entreprise active" n'est mémorisé côté serveur entre deux
 * requêtes (voir `/companies/:companyId/switch`, qui ne fait que
 * confirmer l'accès, sans poser de session).
 *
 * `User.isSuperAdmin` court-circuite les points 2-5 : un super-admin
 * agit au niveau plateforme, indépendamment de toute appartenance à une
 * entreprise (voir schema.prisma pour la justification de cette
 * séparation).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      // Ne devrait jamais arriver si JwtAuthGuard est bien appliqué
      // avant ce guard — vérification défensive.
      throw new UnauthorizedException('Authentification requise.');
    }

    if (user.isSuperAdmin) {
      request.membership = null; // pas d'appartenance entreprise à résoudre pour un super-admin
      return true;
    }

    const companyId: string | undefined = request.params?.companyId;
    if (!companyId) {
      // Route mal configurée : PermissionsGuard exige un :companyId
      // dans l'URL. Fail-safe : refuser plutôt que d'ignorer le contrôle.
      throw new ForbiddenException('Contexte entreprise manquant.');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || company.status !== 'ACTIVE') {
      await this.denyAndAudit(user.id, companyId, requiredPermissions, 'company_inactive_or_missing');
      throw new ForbiddenException('Entreprise inaccessible.');
    }

    const membership = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      await this.denyAndAudit(user.id, companyId, requiredPermissions, 'not_a_member');
      throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
    }

    const grantedPermissions = membership.role.rolePermissions.map((rp: any) => rp.permission.code as string);

    if (requiredPermissions?.length) {
      const missing = requiredPermissions.filter((p) => !grantedPermissions.includes(p));
      if (missing.length > 0) {
        await this.denyAndAudit(user.id, companyId, requiredPermissions, 'missing_permission', membership.id);
        throw new ForbiddenException(`Permission(s) manquante(s) : ${missing.join(', ')}`);
      }
    }

    request.membership = {
      userCompanyId: membership.id,
      companyId,
      roleId: membership.roleId,
      roleName: membership.role.name,
      permissions: grantedPermissions,
    };

    return true;
  }

  private async denyAndAudit(
    userId: string,
    companyId: string,
    requiredPermissions: string[] | undefined,
    reason: string,
    userCompanyId?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          companyId,
          action: 'PERMISSION_DENIED' as any,
          entityType: 'UserCompany',
          entityId: userCompanyId ?? null,
          // Volontairement aucune donnée sensible : uniquement la raison
          // catégorique et les codes de permission demandés (jamais un
          // token, un mot de passe, ni un identifiant hors de ce contexte).
          newValue: { reason, requiredPermissions: requiredPermissions ?? [] } as any,
        },
      });
    } catch {
      // L'audit ne doit jamais faire échouer le refus d'accès lui-même.
    }
  }
}
