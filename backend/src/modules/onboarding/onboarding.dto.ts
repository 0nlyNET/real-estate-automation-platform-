import {
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
} from 'class-validator';

export class UpdateOnboardingDto {
  @IsOptional() @IsObject()
  businessIdentity?: Record<string, unknown>;

  @IsOptional() @IsObject()
  contacts?: Record<string, unknown>;

  @IsOptional() @IsObject()
  serviceScope?: Record<string, unknown>;

  @IsOptional() @IsObject()
  leadHandling?: Record<string, unknown>;

  @IsOptional() @IsObject()
  brandCommunication?: Record<string, unknown>;

  @IsOptional() @IsObject()
  consentConfiguration?: Record<string, unknown>;

  @IsOptional() @IsObject()
  integrationConfiguration?: Record<string, unknown>;

  @IsOptional() @IsBoolean()
  smsEnabled?: boolean;

  @IsOptional() @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional() @IsBoolean()
  bookingEnabled?: boolean;

  @IsOptional() @IsDateString()
  targetLaunchDate?: string | null;
}

export class OperatorOnboardingEvidenceDto {
  @IsOptional() @IsUUID()
  assignedOnboardingOwnerId?: string | null;

  @IsOptional() @IsObject()
  providerTests?: Record<string, unknown>;

  @IsOptional() @IsObject()
  verifiedItems?: Record<string, unknown>;

  @IsOptional() @IsDateString()
  consentPolicyAcknowledgedAt?: string | null;

  @IsOptional() @IsDateString()
  testLeadCompletedAt?: string | null;

  @IsOptional() @IsDateString()
  inboundSmsTestedAt?: string | null;

  @IsOptional() @IsDateString()
  inboundEmailTestedAt?: string | null;

  @IsOptional() @IsDateString()
  stopTestedAt?: string | null;

  @IsOptional() @IsDateString()
  providerRejectionTestedAt?: string | null;

  @IsOptional() @IsDateString()
  billingVerifiedAt?: string | null;

  @IsOptional() @IsDateString()
  clientApprovedAt?: string | null;

  @IsOptional() @IsString() @MaxLength(5000)
  clientApprovalEvidence?: string | null;

  @IsOptional() @IsBoolean()
  operatorApproved?: boolean;
}
