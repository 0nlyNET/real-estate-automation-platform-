import { IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  fullName?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsIn(['buyer', 'seller', 'renter', 'investor'])
  leadType?: string | null;

  @IsOptional()
  @IsIn(['new','contacted','qualified','appointment_set','showing_scheduled','offer_out','under_contract','closed','nurture','lost'])
  stage?: string;

  @IsOptional()
  @IsIn(['hot','warm','cold'])
  temperature?: string;

  @IsOptional()
  @IsInt()
  score?: number;

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
  @IsArray()
  preferredAreas?: string[] | null;

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
}
