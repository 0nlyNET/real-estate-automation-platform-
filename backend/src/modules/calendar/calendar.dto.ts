import { IsDateString, IsIn, IsString, MaxLength } from 'class-validator';
import { BookingProviderName } from './booking-provider.types';

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

export class SelectBookingProviderDto {
  @IsIn(['google_calendar', 'microsoft_calendar', 'calendly'])
  provider!: BookingProviderName;
}
