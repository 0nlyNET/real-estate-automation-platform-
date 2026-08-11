import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsOptional()
  @IsUUID()
  assignedOperatorId?: string | null;
}

export class AssignClientDto {
  @IsOptional()
  @IsUUID()
  assignedOperatorId?: string | null;
}

export class SetPlatformStaffDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ImpersonateDto {
  @IsUUID()
  userId!: string;
}

export class SuspendClientServicesDto {
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class SuspendClientDto {
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  internalNote?: string;
}

export class UsagePolicyDto {
  @IsInt() @Min(1)
  maxSmsPerHour!: number;

  @IsInt() @Min(1)
  maxSmsPerDay!: number;

  @IsInt() @Min(1)
  maxEmailsPerHour!: number;

  @IsInt() @Min(1)
  maxEmailsPerDay!: number;

  @IsInt() @Min(1)
  maxAiCallsPerDay!: number;

  @IsInt() @Min(1)
  maxLeadsPerHour!: number;

  @IsInt() @Min(50) @Max(99)
  warningPercentage!: number;

  @IsNumber() @Min(0)
  warningCostThresholdUsd!: number;

  @IsNumber() @Min(0.0001)
  hardCostThresholdUsd!: number;

  @IsBoolean()
  enabled!: boolean;
}
