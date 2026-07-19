import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class CalendarService {
  async createBookingEvent(_payload: {
    tenantId: string;
    leadId: string;
    start: Date;
    end: Date;
    summary: string;
  }) {
    throw new ServiceUnavailableException(
      'Calendar synchronization is not available. Use the configured external booking link.',
    );
  }
}
