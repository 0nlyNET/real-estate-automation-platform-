import { AiConversationService } from '../ai/ai-conversation.service';
import { MessagingService } from '../messaging/messaging.service';
import { SequencesService } from '../sequences/sequences.service';

describe('Actual worker poller liveness', () => {
  const original = { ...process.env };
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
  });
  afterEach(() => { jest.useRealTimers(); process.env = { ...original }; });

  it.each([
    ['message_sender', MessagingService, 18, 'processPendingOutbound', 5000],
    ['ai_worker', AiConversationService, 23, 'processPendingRuns', 3000],
    ['sequence_worker', SequencesService, 12, 'processDueEnrollments', 10000],
  ] as const)('%s reports idle polls and failures independently of sent messages', async (key, Type, count, method, interval) => {
    const heartbeats = {
      recordTick: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const worker = new (Type as any)(...Array.from({ length: count }, () => ({})), heartbeats);
    const poll = jest.spyOn(worker, method).mockResolvedValue({ processed: 0 });
    worker.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    try {
      worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(interval);
      expect(heartbeats.recordTick).toHaveBeenCalledWith(key);
      expect(heartbeats.recordFailure).not.toHaveBeenCalled();
      heartbeats.recordTick.mockClear();
      const failure = new Error('Database acquisition timed out');
      poll.mockRejectedValue(failure);
      await jest.advanceTimersByTimeAsync(interval);
      expect(heartbeats.recordFailure).toHaveBeenCalledWith(key, failure);
      expect(heartbeats.recordTick).not.toHaveBeenCalled();
      worker.onModuleDestroy();
      heartbeats.recordFailure.mockClear();
      await jest.advanceTimersByTimeAsync(interval * 2);
      expect(heartbeats.recordFailure).not.toHaveBeenCalled();
    } finally { worker.onModuleDestroy(); }
  });
});
