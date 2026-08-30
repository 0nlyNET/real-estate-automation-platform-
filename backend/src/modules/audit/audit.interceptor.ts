import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import {
  Observable,
  catchError,
  concatMap,
  dematerialize,
  from,
  map,
  materialize,
  of,
} from 'rxjs';
import { AuditService } from './audit.service';
import { operationalEvent } from '../../common/operational-log';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const OPERATIONAL_PATHS = new Set(['/presence/heartbeat']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<any>();
    const response = context.switchToHttp().getResponse<any>();
    const method = String(request?.method || '').toUpperCase();
    const tenantId = request?.user?.tenantId;
    const subjectUserId = request?.user?.sub;
    const acting = request?.user?.impersonatedBy;
    const actorId = acting?.userId || subjectUserId;
    const actorEmail = acting?.email || request?.user?.email;

    if (!MUTATION_METHODS.has(method) || !tenantId || !actorId) {
      return next.handle();
    }

    const path = String(request?.originalUrl || request?.url || '/')
      .split('?')[0]
      .slice(0, 500);
    if (OPERATIONAL_PATHS.has(path)) return next.handle();

    return next.handle().pipe(
      materialize(),
      concatMap((notification) => {
        // A normal HTTP observable emits a value and then a completion
        // notification. Only the value/error represents the request outcome.
        if (notification.kind === 'C') return of(notification);

        const errorStatus =
          notification.kind === 'E'
            ? Number(
                notification.error?.status ||
                  notification.error?.statusCode ||
                  (typeof notification.error?.getStatus === 'function'
                    ? notification.error.getStatus()
                    : 0),
              )
            : 0;
        const statusCode =
          notification.kind === 'E'
            ? errorStatus || 500
            : Number(response?.statusCode || 200);
        return from(
          this.audit.record({
            tenantId,
            actorId,
            actorType: acting ? 'platform_operator' : 'user',
            actorEmail,
            action: `${method} ${path}`,
            eventType: `${method} ${path}`,
            resourceType: path.split('/').filter(Boolean)[0] || 'request',
            resourceId:
              Object.values(request?.params || {}).find((value) =>
                /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(value)),
              ) as string | undefined,
            ipAddress: String(request?.ip || request?.socket?.remoteAddress || '').slice(0, 64) || null,
            method,
            path,
            statusCode,
            metadata: {
              subjectUserId,
              subjectRole: request?.user?.role || null,
              impersonated: Boolean(acting),
            },
          }),
        ).pipe(
          catchError((error) => {
            this.logger.error(
              operationalEvent('audit_write_failed', {
                error: error?.message || error,
              }),
            );
            return of(null);
          }),
          map(() => notification),
        );
      }),
      dematerialize(),
    );
  }
}
