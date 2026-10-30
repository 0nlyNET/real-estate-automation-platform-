import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { requestIdOf } from '../../common/request-diagnostics';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  // Diagnostic instrumentation (temporary): record elapsed time and outcome
  // for every guarded request — including denials where passport rejects the
  // token before JwtStrategy.validate runs — under the shared request ID.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const requestId = requestIdOf(req);
    const start = Date.now();
    try {
      const result = (await super.canActivate(context)) as boolean;
      this.logger.log(
        `[diag][${requestId}] auth_guard outcome=authenticated elapsedMs=${Date.now() - start} path=${req?.path || 'unknown'}`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `[diag][${requestId}] auth_guard outcome=denied elapsedMs=${Date.now() - start} path=${req?.path || 'unknown'} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
