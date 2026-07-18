import { IsEmail, IsString, IsUUID, Length } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @IsEmail()
  ownerEmail!: string;
}

export class ImpersonateDto {
  @IsUUID()
  userId!: string;
}
