import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LeadConsentDto } from '../compliance/consent.dto';
import { CRM_EVENT_TYPES } from '../crm-events/crm-events.service';

class ZapierPropertyDto {
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(160) city?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(500) listingUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsString() @MaxLength(120) price?: string;
}

export class ZapierLeadIngressDto {
  @IsString() @IsNotEmpty() @MaxLength(255) externalEventId!: string;
  @IsOptional() @IsString() @MaxLength(255) externalLeadId?: string;
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(160) source?: string;
  @IsOptional() @IsString() @MaxLength(80) sourceSystem?: string;
  @IsOptional() @IsString() @MaxLength(2_000) message?: string;
  @IsOptional() @IsIn(['buyer', 'seller', 'renter', 'investor']) leadType?: string;
  @IsOptional() @IsIn(['cold', 'warm', 'hot']) temperature?: string;
  @IsOptional() @ValidateNested() @Type(() => ZapierPropertyDto) property?: ZapierPropertyDto;
  @IsOptional() @ValidateNested() @Type(() => LeadConsentDto) consent?: LeadConsentDto;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CreateZapierConnectionDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string;
}

export class CreateWebhookSubscriptionDto {
  @IsIn(CRM_EVENT_TYPES as unknown as string[])
  eventType!: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  targetUrl!: string;
}
