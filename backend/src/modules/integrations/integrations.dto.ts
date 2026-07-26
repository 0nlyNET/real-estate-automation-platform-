import { IsOptional, IsString } from 'class-validator';

export class UpsertTwilioDto {
  @IsString()
  accountSid!: string;

  @IsString()
  authToken!: string;

  @IsString()
  fromNumber!: string;
}

export class TestTwilioDto {
  @IsOptional()
  @IsString()
  toNumber?: string;

  @IsOptional()
  @IsString()
  message?: string;
}

export class UpsertSendGridDto {
  @IsString()
  apiKey!: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  inboundAddress?: string;
}

export class TestSendGridDto {
  @IsOptional()
  @IsString()
  toEmail?: string;
}

export class PlatformTwilioDto {
  @IsString()
  accountSid!: string;

  @IsString()
  authToken!: string;
}

export class TestPlatformTwilioDto extends TestTwilioDto {
  @IsOptional()
  @IsString()
  fromNumber?: string;
}

export class PlatformSendGridDto {
  @IsString()
  apiKey!: string;
}

export class TestPlatformSendGridDto extends TestSendGridDto {
  @IsOptional()
  @IsString()
  fromEmail?: string;
}

export class AssignManagedTwilioDto {
  @IsString()
  fromNumber!: string;
}

export class AssignManagedSendGridDto {
  @IsString()
  fromEmail!: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  inboundAddress?: string;
}

export class UpsertFacebookLeadAdsDto {
  @IsString()
  pageId!: string;

  @IsString()
  accessToken!: string;

  @IsOptional()
  @IsString()
  verifyToken?: string;
}

export class SelectFacebookPageDto {
  @IsString()
  pageId!: string;
}
