import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  isSuperAdmin: boolean;
}

/**
 * Usage : `@CurrentUser() user: AuthenticatedUser` dans un contrôleur
 * protégé par `JwtAuthGuard`. Lit `request.user`, peuplé par
 * `JwtStrategy.validate()` — jamais le payload JWT brut.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
