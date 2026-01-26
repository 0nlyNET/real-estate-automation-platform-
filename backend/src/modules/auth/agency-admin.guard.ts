import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class AgencyAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.user?.role;
    if (role !== 'AGENCY_ADMIN') {
      throw new ForbiddenException('Agency admin access required');
    }
    return true;
  }
}
