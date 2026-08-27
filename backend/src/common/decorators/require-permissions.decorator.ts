import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Usage : `@RequirePermissions('ENTRY.VALIDATE')` (une ou plusieurs
 * permissions — toutes sont exigées, sémantique ET). À combiner
 * systématiquement avec `@UseGuards(JwtAuthGuard, PermissionsGuard)`,
 * dans cet ordre (JwtAuthGuard doit peupler `request.user` avant que
 * PermissionsGuard ne s'exécute).
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
