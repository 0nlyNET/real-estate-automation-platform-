import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  leadId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  body!: string;

  @IsOptional()
  @IsIn(['sms', 'email'])
  channel?: 'sms' | 'email';

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class SendBookingLinkDto {
  @IsUUID()
  leadId!: string;
}
