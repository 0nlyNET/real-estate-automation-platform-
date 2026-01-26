import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateAgencyApplicationDto {
  @IsString()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  teamSize?: string;

  @IsOptional()
  @IsString()
  leadSources?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sourcePage?: string;
}
