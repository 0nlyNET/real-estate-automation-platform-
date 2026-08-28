import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    _error: unknown,
    user: TUser | false | null | undefined,
  ): TUser | null {
    return user || null;
  }
}
