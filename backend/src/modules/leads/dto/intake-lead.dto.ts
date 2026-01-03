import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

export class IntakeLeadDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  propertyInterest?: string;

  @IsOptional()
  @IsIn(['buyer', 'seller', 'investor', 'renter'])
  leadType?: 'buyer' | 'seller' | 'investor' | 'renter';

  @IsOptional()
  @IsIn(['hot', 'warm', 'cold'])
  temperature?: 'hot' | 'warm' | 'cold';
}
