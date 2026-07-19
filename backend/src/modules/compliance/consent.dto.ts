import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ConsentEvidenceDto {
  @IsBoolean()
  affirmative!: boolean;

  @IsString()
  @MaxLength(255)
  source!: string;

  @IsDateString()
  consentedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  disclosureText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  disclosureVersion?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1_000)
  captureUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceIdentifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  captureIp?: string;

  @IsOptional()
  @IsBoolean()
  clientAttested?: boolean;
}

export class LeadConsentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  sms?: ConsentEvidenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentEvidenceDto)
  email?: ConsentEvidenceDto;
}
