import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { planHasTeamsFeatures } from '../plans';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../modules/tenants/tenant.entity';

export const REQUIRE_TEAMS_PLAN_KEY = 'require_teams_plan';

// Use this on routes that require multi-user/team/brokerage features.
export const RequireTeamsPlan = () => SetMetadata(REQUIRE_TEAMS_PLAN_KEY, true);

@Injectable()
export class TeamsPlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_TEAMS_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<any>();
    const tenantId = req.user?.tenantId;
    const tenant = tenantId ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
    const active = tenant && ['active', 'trialing'].includes(String(tenant.status));
    if (!active || !planHasTeamsFeatures(tenant.plan)) {
      throw new ForbiddenException('This feature requires the Teams plan');
    }
    return true;
  }
}
