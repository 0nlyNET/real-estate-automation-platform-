import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RoutingRulePayloadDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) priority?: number;
  @IsOptional() @IsObject() conditions?: Record<string, unknown>;
  @IsIn(['round_robin_team', 'fixed_user']) actionType!: 'round_robin_team' | 'fixed_user';
  @IsObject() actionConfig!: Record<string, unknown>;
}

export class UpsertRoutingRuleDto {
  @ValidateNested() @Type(() => RoutingRulePayloadDto)
  rule!: RoutingRulePayloadDto;
}
