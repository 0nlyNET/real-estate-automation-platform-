import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LeadConsentDto } from '../../compliance/consent.dto';

const LEAD_TYPES = ['buyer', 'seller', 'renter', 'investor'] as const;
const TEMPERATURES = ['cold', 'warm', 'hot'] as const;
const STAGES = ['new', 'contacted', 'qualified', 'appointment_set', 'showing_scheduled', 'offer_out', 'under_contract', 'closed', 'nurture', 'lost'] as const;

export class IntakeLeadDto {
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
  message?: string;

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
  @IsString()
  @MaxLength(500)
  temperatureReason?: string;

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
}
