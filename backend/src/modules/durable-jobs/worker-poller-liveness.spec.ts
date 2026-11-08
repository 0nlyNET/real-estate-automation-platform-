import { ServiceControlService } from '../service-control/service-control.service';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { OperationalRemindersService } from '../notifications/operational-reminders.service';
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
    ['billing_grace_monitor', ServiceControlService, 5, 'suspendExpiredBillingGrace', 300000],
    ['handoff_escalation', ClientOperationsService, 9, 'runOperationalChecks', 60000],
    ['operational_reminders', OperationalRemindersService, 3, 'run', 3600000],
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


it('performs the first actual billing-grace check within five seconds of boot', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; jest.useFakeTimers();
  const heartbeats = {recordTick: jest.fn(async () => undefined), recordFailure: jest.fn(async () => undefined)};
  const worker = new ServiceControlService({} as any, {} as any, {} as any, {} as any, undefined, heartbeats as any);
  const check = jest.spyOn(worker, 'suspendExpiredBillingGrace').mockResolvedValue({checked:0,suspended:0});
  try {
    worker.onModuleInit(); expect(heartbeats.recordTick).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(heartbeats.recordTick).toHaveBeenCalledWith('billing_grace_monitor');
  } finally {worker.onModuleDestroy(); jest.useRealTimers(); process.env.NODE_ENV = original;}
});
