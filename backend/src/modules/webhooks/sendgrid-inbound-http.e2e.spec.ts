import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { LeadEvent } from '../leads/lead-event.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('SendGrid authenticated inbound HTTP workflow', () => {
  const original = { ...process.env };
  let app: INestApplication;
  let messageRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let sequences: { stopForLead: jest.Mock };
  let ai: { acceptInbound: jest.Mock };

  beforeEach(async () => {
    process.env.SENDGRID_INBOUND_USERNAME = 'rta_sendgrid_inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';

    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000020',
      tenantId: '00000000-0000-4000-8000-000000000001',
      fullName: 'Jordan Client',
      email: 'jordan@example.com',
      sequenceStatus: 'active',
    });
    messageRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value) =>
        Object.assign(value, {
          id: '00000000-0000-4000-8000-000000000030',
        }),
      ),
    };
    const leadRepository = {
      findOne: jest.fn().mockResolvedValue(lead),
      create: jest.fn((value) => Object.assign(new Lead(), value)),
      save: jest.fn(async (value) => value),
    };
    const leadEventRepository = {
      create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === Message) return messageRepository;
        if (entity === Lead) return leadRepository;
        if (entity === LeadEvent) return leadEventRepository;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        routingKey: 'replies@reply.lakeview.example',
        encryptedValue: JSON.stringify({
          configured: true,
          connected: false,
          error: 'Previous outbound provider test failed',
          inboundAddress: 'replies@reply.lakeview.example',
        }),
        tenant: { id: lead.tenantId },
      }),
      find: jest.fn(),
      save: jest.fn(),
    };
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(false),
      addOptOut: jest.fn(),
    };
    sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
    ai = { acceptInbound: jest.fn().mockResolvedValue({ status: 'queued' }) };
    const webhooks = new WebhooksService(
      dataSource as any,
      credentials as any,
      compliance as any,
      sequences as any,
      { intake: jest.fn() } as any,
      ai as any,
      undefined,
      { createTask: jest.fn() } as any,
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: webhooks }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('issues a token and accepts a real multipart reply when outbound SendGrid is unavailable', async () => {
    const tokenResponse = await request(app.getHttpServer())
      .post('/webhooks/sendgrid/oauth/token')
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'rta_sendgrid_inbound',
        client_secret: 'strong-test-password',
        scope: 'webhooks:write',
      })
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Pragma', 'no-cache');

    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/inbound')
      .set('Authorization', `Bearer ${tokenResponse.body.access_token}`)
      .field('from', 'Jordan Client <jordan@example.com>')
      .field(
        'envelope',
        JSON.stringify({ to: ['replies@reply.lakeview.example'] }),
      )
      .field('subject', 'Austin search')
      .field('text', 'I would like to learn more.')
      .field('headers', 'Message-ID: <http-email-123@example.com>\r\n')
      .expect(201)
      .expect({ status: 'ok' });

    expect(messageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        direction: 'inbound',
        providerMessageId: 'sendgrid:http-email-123@example.com',
        status: 'received',
      }),
    );
    expect(sequences.stopForLead).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000020',
      'reply',
    );
    expect(ai.acceptInbound).toHaveBeenCalledWith({
      tenantId: '00000000-0000-4000-8000-000000000001',
      leadId: '00000000-0000-4000-8000-000000000020',
      messageId: '00000000-0000-4000-8000-000000000030',
      channel: 'email',
    });
  });
});
