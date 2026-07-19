import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSequenceDto {
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsIn(['buyer', 'seller', 'investor', 'renter']) leadType?: string | null;
  @IsOptional() @IsIn(['hot', 'warm', 'cold']) temperature?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateSequenceDto extends CreateSequenceDto {}

export class SequenceStepDto {
  @IsIn(['sms', 'email']) channel!: 'sms' | 'email';
  @IsString() @MinLength(1) @MaxLength(5000) template!: string;
  @IsInt() @Min(0) @Max(525600) offsetMinutes!: number;
  @IsOptional() @IsString() @MaxLength(255) identityLabel?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ApproveSequenceStepDto {
  @IsString() @MinLength(1) @MaxLength(255) identityLabel!: string;
}

export class StopEnrollmentDto {
  @IsOptional() @IsIn(['manual', 'other']) reason?: 'manual' | 'other';
}
