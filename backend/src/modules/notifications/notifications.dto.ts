import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterPushSubscriptionDto {
  @IsString() @MaxLength(4000)
  endpoint!: string;

  @IsObject()
  keys!: { p256dh?: string; auth?: string };

  @IsOptional() @IsString() @MaxLength(120)
  deviceLabel?: string;
}

export class RemovePushSubscriptionDto {
  @IsString() @MaxLength(4000)
  endpoint!: string;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional() @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional() @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional() @IsBoolean()
  privacyMode?: boolean;

  @IsOptional() @IsObject()
  categorySettings?: Record<string, boolean>;

  @IsOptional() @IsObject()
  severitySettings?: Record<string, boolean>;

  @IsOptional() @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursStart?: string;

  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursEnd?: string;

  @IsOptional() @IsString() @MaxLength(100)
  timezone?: string;
}
