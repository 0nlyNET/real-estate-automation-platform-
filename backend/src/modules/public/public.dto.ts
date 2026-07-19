import {
  IsEmail,
  IsIn,
  IsInt,
  Matches,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PublicInquiryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9().\-\s]{7,25}$/, { message: 'phone must be a valid telephone number' })
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  estimatedMonthlyLeadVolume?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestedService?: string;

  @IsOptional()
  @IsIn(['sales', 'support', 'demo', 'setup', 'partnership', 'other'])
  topic?: 'sales' | 'support' | 'demo' | 'setup' | 'partnership' | 'other';

  @IsString()
  @Matches(/\S/, { message: 'message must not be blank' })
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;

  // Hidden browser field. A non-empty value is treated as automated spam.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  websiteConfirmation?: string;
}

export class UpdateApplicationDto {
  @IsOptional()
  @IsIn(['new', 'reviewing', 'qualified', 'consultation_booked', 'accepted', 'declined'])
  status?: 'new' | 'reviewing' | 'qualified' | 'consultation_booked' | 'accepted' | 'declined';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  operatorNotes?: string | null;

  @IsOptional()
  @IsString()
  assignedOperatorId?: string | null;
}
