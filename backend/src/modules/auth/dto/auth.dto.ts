import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Preferred fields used by the frontend
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  tenantName?: string;

  // Backward-compat (older clients)
  @IsOptional()
  @IsString()
  brokerage?: string;
}
