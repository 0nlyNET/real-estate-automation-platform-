import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isPlatformAdminEmail } from '../env';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<any>()?.user;
    if (user?.platformAdmin === true && isPlatformAdminEmail(user?.email)) return true;
    throw new ForbiddenException('Platform administrator access required');
  }
}
