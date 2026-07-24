import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  leadId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  body!: string;
}

export class SendBookingLinkDto {
  @IsUUID()
  leadId!: string;
}
