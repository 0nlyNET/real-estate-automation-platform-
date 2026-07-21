import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateHandoffDto {
  @IsIn(['opened', 'completed', 'snoozed'])
  action!: 'opened' | 'completed' | 'snoozed';

  @IsOptional()
  @IsDateString()
  snoozedUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateHandoffDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CreateAppointmentDto {
  @IsUUID()
  leadId!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  calendarSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalEventId?: string;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsIn(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'])
  status?: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

  @IsOptional()
  @IsIn(['pending', 'confirmed', 'declined'])
  confirmationStatus?: 'pending' | 'confirmed' | 'declined';

  @IsOptional()
  @IsIn(['not_due', 'due', 'completed'])
  followUpStatus?: 'not_due' | 'due' | 'completed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
