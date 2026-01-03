import { Injectable, Logger } from '@nestjs/common';

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
      `[NO-OP QUEUE] enqueue called: ${jobName} payload=${JSON.stringify(payload)}`,
    );
    return;
  }
}