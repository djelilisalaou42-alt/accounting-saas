import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ResolvedMembership {
  userCompanyId: string;
  companyId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

/**
 * Usage : `@CurrentMembership() membership: ResolvedMembership` sur une
 * route protégée par `PermissionsGuard`, qui peuple `request.membership`
 * après avoir vérifié l'appartenance et les permissions. Évite à chaque
 * contrôleur de refaire la même requête.
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedMembership => {
    const request = ctx.switchToHttp().getRequest();
    return request.membership;
  },
);
