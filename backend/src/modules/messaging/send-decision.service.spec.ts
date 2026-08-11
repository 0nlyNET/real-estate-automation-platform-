import { SendDecisionService } from './send-decision.service';

describe('SendDecisionService reconstruction evidence', () => {
  it('captures the automation, configuration, lead, safety, usage, and provider identity', async () => {
    const decisions = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'decision-1', ...value })),
    };
    const enrollments = {
      findOne: jest.fn().mockResolvedValue({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sequenceId: 'sequence-1',
      }),
    };
    const settings = {
      findOne: jest.fn().mockResolvedValue({
        timeZone: 'America/New_York',
        automationsEnabled: true,
      }),
    };
    const service = new SendDecisionService(
      decisions as any,
      enrollments as any,
      settings as any,
    );
    const createdAt = new Date('2026-08-11T12:00:00.000Z');

    const result = await service.record({
      message: {
        id: 'message-1',
        createdAt,
        channel: 'sms',
        authorship: 'template',
        communicationType: 'sequence',
        requiresBookingLink: false,
        idempotencyKey:
          'sequence:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:2:send:v7',
        lead: {
          id: 'lead-1',
          tenantId: 'tenant-1',
          stage: 'new',
          temperature: 'warm',
          communicationStatus: 'active',
          smsEligible: true,
          emailEligible: false,
          optedOutAt: null,
          testRunId: null,
        },
      } as any,
      safety: {
        allowed: true,
        reasons: [],
        ruleIds: ['tenant-active', 'consent-present'],
      } as any,
      usage: { allowed: true, reservationId: 'reservation-1' },
      providerIdentity: {
        provider: 'twilio',
        accountSid: 'AC-tenant',
        messagingServiceSid: 'MG-tenant',
      },
      decision: 'submitted',
    });

    expect(result).toMatchObject({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      messageId: 'message-1',
      automationId: 'sequence-1',
      enrollmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stepIndex: 2,
      templateVersion: 7,
      usageReservationId: 'reservation-1',
      decision: 'submitted',
      configurationSnapshot: expect.objectContaining({
        timeZone: 'America/New_York',
        automationsEnabled: true,
      }),
      safetyDecision: {
        allowed: true,
        reasons: [],
        ruleIds: ['tenant-active', 'consent-present'],
      },
      providerIdentity: expect.objectContaining({
        provider: 'twilio',
        accountSid: 'AC-tenant',
      }),
    });
  });
});
