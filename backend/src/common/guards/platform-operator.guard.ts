import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isPlatformAdminEmail } from '../env';

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<any>()?.user;
    if (
      user?.platformOperator === true &&
      (user?.platformRole === 'staff' ||
        (user?.platformRole === 'super_admin' && isPlatformAdminEmail(user?.email)))
    ) return true;
    throw new ForbiddenException('Platform operator access required');
  }
}
