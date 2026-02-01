import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
  @IsIn(['sales', 'support', 'demo', 'setup', 'partnership', 'other'])
  topic?: 'sales' | 'support' | 'demo' | 'setup' | 'partnership' | 'other';

  @IsString()
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;
}
