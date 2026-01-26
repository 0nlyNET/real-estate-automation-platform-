import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { planHasTeamsFeatures } from '../plans';

export const REQUIRE_TEAMS_PLAN_KEY = 'require_teams_plan';

// Use this on routes that require multi-user/team/brokerage features.
export const RequireTeamsPlan = () => SetMetadata(REQUIRE_TEAMS_PLAN_KEY, true);

@Injectable()
export class TeamsPlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_TEAMS_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<any>();
    const plan = (req.user?.plan as any) || 'trial';
    if (!planHasTeamsFeatures(plan)) {
      throw new ForbiddenException('This feature requires the Teams plan');
    }
    return true;
  }
}
