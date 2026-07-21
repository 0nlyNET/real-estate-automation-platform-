import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LeadConsentDto } from '../../compliance/consent.dto';

const LEAD_TYPES = ['buyer', 'seller', 'renter', 'investor'] as const;
const TEMPERATURES = ['cold', 'warm', 'hot'] as const;
const STAGES = ['new', 'contacted', 'qualified', 'appointment_set', 'showing_scheduled', 'offer_out', 'under_contract', 'closed', 'nurture', 'lost'] as const;
const READINESS_LEVELS = ['not_ready', 'exploring', 'ready', 'urgent'] as const;

export class CreateLeadDto {
  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  propertyInterest?: string;

  @IsOptional()
  @IsIn(LEAD_TYPES as unknown as string[])
  leadType?: (typeof LEAD_TYPES)[number];

  @IsOptional()
  @IsIn(TEMPERATURES as unknown as string[])
  temperature?: (typeof TEMPERATURES)[number];

  @IsOptional()
  @IsIn(STAGES as unknown as string[])
  stage?: (typeof STAGES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeadConsentDto)
  consent?: LeadConsentDto;

  @IsOptional()
  @IsBoolean()
  triggerAutomation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  temperatureReason?: string;

  @IsOptional()
  @IsIn(READINESS_LEVELS as unknown as string[])
  readinessLevel?: (typeof READINESS_LEVELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainBlocker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  timeline?: string;

  @IsOptional()
  @IsIn(['yes', 'no', 'unsure'])
  preapproved?: 'yes' | 'no' | 'unsure';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  budgetRange?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  estimatedPrice?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string;
}
