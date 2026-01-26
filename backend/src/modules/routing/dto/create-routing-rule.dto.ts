import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import type { RoutingActionType, RoutingMatchType } from '../entities/routing-rule.entity';

export class CreateRoutingRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  priority?: number;

  @IsIn(['source', 'location', 'lead_type', 'stage'])
  matchType: RoutingMatchType;

  @IsOptional()
  @IsString()
  matchValue?: string;

  @IsIn(['round_robin_team', 'fixed_user'])
  actionType: RoutingActionType;

  @IsOptional()
  @IsUUID()
  actionTeamId?: string;

  @IsOptional()
  @IsUUID()
  actionUserId?: string;

  @IsOptional()
  @IsUUID()
  fallbackTeamId?: string;

  @IsOptional()
  @IsUUID()
  fallbackUserId?: string;
}
