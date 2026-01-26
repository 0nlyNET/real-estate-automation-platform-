import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, hasAtLeastRole } from '../rbac';

export const REQUIRE_ROLE_KEY = 'require_role';

export const RequireRole = (role: UserRole) => SetMetadata(REQUIRE_ROLE_KEY, role);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole | undefined>(REQUIRE_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<any>();
    const role = (req.user?.role as UserRole) || 'read_only';
    if (!hasAtLeastRole(role, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
