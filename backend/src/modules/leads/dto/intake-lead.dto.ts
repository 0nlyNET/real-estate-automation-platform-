import { IsArray, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

// Public intake payloads (forms/webhooks). Everything is optional because sources vary.
// The service layer applies required checks and defaults.
export class IntakeLeadDto {
  @IsOptional()
  @IsString()
  fullName?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  source?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsString()
  propertyInterest?: string | null;

  @IsOptional()
  @IsString()
  budgetRange?: string | null;

  @IsOptional()
  @IsString()
  estimatedPrice?: string | null;

  @IsOptional()
  @IsArray()
  preferredAreas?: string[] | null;

  @IsOptional()
  @IsIn(['buyer', 'seller', 'renter', 'investor'])
  leadType?: string | null;

  @IsOptional()
  @IsIn(['hot', 'warm', 'cold'])
  temperature?: string | null;

  @IsOptional()
  @IsIn(['new','contacted','qualified','appointment_set','showing_scheduled','offer_out','under_contract','closed','nurture','lost'])
  stage?: string | null;

  @IsOptional()
  @IsString()
  timeline?: string | null;

  @IsOptional()
  @IsIn(['buy','rent','sell'])
  buyOrRent?: string | null;

  @IsOptional()
  @IsIn(['yes','no','unsure'])
  preapproved?: string | null;

  @IsOptional()
  @IsString()
  bestTimeToTalk?: string | null;

  @IsOptional()
  @IsArray()
  tags?: string[] | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  campaign?: string | null;
}
