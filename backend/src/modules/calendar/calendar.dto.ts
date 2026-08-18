import { IsDateString, IsString, MaxLength } from 'class-validator';

export class SelectCalendarDto {
  @IsString()
  @MaxLength(1_000)
  calendarId!: string;
}

export class CheckAvailabilityDto {
  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
