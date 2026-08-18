import { BookingProviderName } from './booking-provider.types';

export class BookingProviderApiError extends Error {
  constructor(
    public readonly provider: BookingProviderName,
    public readonly code: string,
    message: string,
    public readonly status: number | null,
    public readonly transient: boolean,
    public readonly outcomeUncertain = false,
  ) {
    super(message);
  }
}
