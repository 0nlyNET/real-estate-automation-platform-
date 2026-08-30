import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Matches,
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

export class ControlledTestRunDto {
  @IsOptional()
  @IsString()
  @Length(7, 40)
  smsRecipient?: string;

  @IsOptional()
  @IsEmail()
  emailRecipient?: string;
}

export class RequestOffboardingDto {
  @IsString()
  @Length(3, 2000)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  retentionDays?: number;
}

export class SetTwilioComplianceDto {
  @IsIn(['not_started', 'pending', 'approved', 'blocked'])
  status!: 'not_started' | 'pending' | 'approved' | 'blocked';

  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  customerProfileSid?: string;

  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  brandSid?: string;

  @IsOptional()
  @IsString()
  @Length(3, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  campaignSid?: string;
}
