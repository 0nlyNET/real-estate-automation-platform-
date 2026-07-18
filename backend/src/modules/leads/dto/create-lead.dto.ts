import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

const LEAD_TYPES = ['buyer', 'seller', 'renter', 'investor'] as const;
const TEMPERATURES = ['cold', 'warm', 'hot'] as const;
const STAGES = ['new', 'contacted', 'qualified', 'appointment_set', 'showing_scheduled', 'offer_out', 'under_contract', 'closed', 'nurture', 'lost'] as const;

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
}
