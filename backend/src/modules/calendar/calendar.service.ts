import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  async createBookingEvent(payload: {
    tenantId: string;
    leadId: string;
    start: Date;
    end: Date;
    summary: string;
  }) {
    this.logger.log(`Mock create calendar event ${payload.summary}`);
    return { eventId: 'mock-event' };
  }
}
