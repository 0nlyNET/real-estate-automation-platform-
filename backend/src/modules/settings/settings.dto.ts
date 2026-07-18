import { IsBoolean, IsOptional, IsString, IsUUID, IsUrl, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateTenantSettingsDto {
  @IsOptional() @IsString() @MaxLength(100)
  timeZone?: string;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursStart?: string;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursEnd?: string;

  @IsOptional() @ValidateIf((_object, value) => value !== '')
  @IsUrl({ require_protocol: true }, { message: 'bookingLink must be a full URL' })
  bookingLink?: string;

  @IsOptional() @IsBoolean()
  automationsEnabled?: boolean;

  @IsOptional() @IsBoolean()
  roundRobinEnabled?: boolean;

  @IsOptional() @IsUUID()
  roundRobinTeamId?: string | null;
}
