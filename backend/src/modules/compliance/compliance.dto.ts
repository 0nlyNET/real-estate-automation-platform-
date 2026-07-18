import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AddOptOutDto {
  @IsIn(['sms', 'email']) channel!: 'sms' | 'email';
  @IsString() @MaxLength(320) value!: string;
  @IsOptional() @IsString() @MaxLength(100) reason?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
}

export class QuietHoursDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(0) @Max(1439) endMinute!: number;
  @IsString() @MaxLength(100) timezone!: string;
}
