import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsOptional()
  @IsUUID()
  assignedOperatorId?: string | null;
}

export class AssignClientDto {
  @IsOptional()
  @IsUUID()
  assignedOperatorId?: string | null;
}

export class SetPlatformStaffDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ImpersonateDto {
  @IsUUID()
  userId!: string;
}
