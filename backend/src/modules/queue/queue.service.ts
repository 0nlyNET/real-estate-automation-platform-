import { Injectable, Logger } from '@nestjs/common';
import { operationalEvent } from '../../common/operational-log';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  /**
   * Temporary no-op queue for Railway demo.
   * This prevents Redis/BullMQ from being required in production right now.
   * Later, we can swap back to BullMQ when you add Redis on Railway.
   */
  async enqueue(jobName: string, payload: unknown): Promise<void> {
    this.logger.warn(
      operationalEvent('unavailable_queue_enqueue_requested', {
        jobName,
        payloadType: Array.isArray(payload) ? 'array' : typeof payload,
        payloadKeys:
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? Object.keys(payload as Record<string, unknown>).slice(0, 25)
            : [],
      }),
    );
    return;
  }
}
