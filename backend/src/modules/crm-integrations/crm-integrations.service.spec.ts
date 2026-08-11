import { BadRequestException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { createHash } from 'crypto';
import { CrmIntegrationsService } from './crm-integrations.service';
import { ZapierLeadIngressDto } from './crm-integrations.dto';

describe('CrmIntegrationsService Zapier ingress', () => {
  const secret = 's'.repeat(43);
  const connection: any = {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: '00000000-0000-4000-8000-000000000001',
    provider: 'zapier', status: 'active', publicIdentifier: 'publicABC123',
    secretHash: createHash('sha256').update(secret).digest('hex'), secretLast4: 'ssss',
    configuration: {}, capabilities: {}, lastUsedAt: null, lastTestedAt: null,
    lastError: null, revokedAt: null,
  };

  function setup(activeConnection: any = connection) {
    const ingress = new Map<string, any>();
    const connections: any = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.publicIdentifier) {
          return where.publicIdentifier === activeConnection.publicIdentifier &&
            where.status === activeConnection.status ? activeConnection : null;
        }
        return where.id === activeConnection.id && where.tenantId === activeConnection.tenantId
          ? activeConnection : null;
      }),
      save: jest.fn(async (value) => value), count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value) => value), find: jest.fn().mockResolvedValue([activeConnection]),
    };
    const ingressEvents: any = {
      findOne: jest.fn(async ({ where }: any) => ingress.get(`${where.connectionId}:${where.externalEventId}`) || null),
      findOneOrFail: jest.fn(async ({ where }: any) => ingress.get(`${where.connectionId}:${where.externalEventId}`)),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        ingress.set(`${value.connectionId}:${value.externalEventId}`, value);
        return value;
      }),
      createQueryBuilder: jest.fn(() => {
        const builder: any = {
          insert: jest.fn(() => builder), into: jest.fn(() => builder),
          values: jest.fn((value) => { builder.value = value; return builder; }),
          execute: jest.fn(async () => {
            ingress.set(`${builder.value.connectionId}:${builder.value.externalEventId}`, builder.value);
            return { identifiers: [{ id: builder.value.id }] };
          }),
        };
        return builder;
      }),
    };
    const leads = {
      intake: jest.fn(async (tenantId, payload) => ({ id: '00000000-0000-4000-8000-000000000020', tenantId, ...payload })),
      applyIntegrationAttribution: jest.fn(async (tenantId, id, attribution) => ({ id, tenantId, ...attribution })),
    };
    const testRuns = { findOne: jest.fn().mockResolvedValue(null) };
    const events = {
      createSubscription: jest.fn(), listSubscriptions: jest.fn(),
      revokeSubscription: jest.fn(), testSubscription: jest.fn(),
    };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new CrmIntegrationsService(
      connections, ingressEvents, testRuns as any, leads as any, events as any, audit as any,
    );
    return { service, connections, ingressEvents, leads, testRuns, ingress };
  }

  const request = (overrides: Record<string, unknown> = {}) => ({
    authorization: `Bearer rtzi_${connection.publicIdentifier}.${secret}`,
    headerEventId: 'event-1',
    payload: {
      externalEventId: 'event-1', externalLeadId: 'kw-123',
      firstName: 'Jordan', lastName: 'Buyer', email: 'jordan@example.com',
      sourceSystem: 'kw_command', source: 'facebook',
      ...overrides,
    } as any,
  });

  it('resolves the immutable tenant from the credential and preserves attribution', async () => {
    const { service, leads } = setup();
    const result = await service.ingestZapierLead(request({
      tenantId: '00000000-0000-4000-8000-000000000099',
    }));
    expect(result).toMatchObject({ accepted: true, deduplicated: false });
    expect(leads.intake).toHaveBeenCalledWith(
      connection.tenantId,
      expect.objectContaining({
        fullName: 'Jordan Buyer', ingestionProvider: 'zapier',
        sourceSystem: 'kw_command', originalSource: 'facebook', externalLeadId: 'kw-123',
      }),
      { source: 'zapier' },
    );
    expect(leads.intake).not.toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000099', expect.anything(), expect.anything(),
    );
  });

  it('resolves independent tenant credentials to independent immutable contexts', async () => {
    const tenantBSecret = 'b'.repeat(43);
    const tenantB = {
      ...connection,
      id: '00000000-0000-4000-8000-000000000011',
      tenantId: '00000000-0000-4000-8000-000000000002',
      publicIdentifier: 'publicXYZ789',
      secretHash: createHash('sha256').update(tenantBSecret).digest('hex'),
      secretLast4: 'bbbb',
    };
    const a = setup();
    const b = setup(tenantB);
    await a.service.ingestZapierLead(request());
    await b.service.ingestZapierLead({
      authorization: `Bearer rtzi_${tenantB.publicIdentifier}.${tenantBSecret}`,
      headerEventId: 'event-b',
      payload: { ...request().payload, externalEventId: 'event-b', email: 'tenant-b@example.com' },
    });
    expect(a.leads.intake).toHaveBeenCalledWith(connection.tenantId, expect.anything(), expect.anything());
    expect(b.leads.intake).toHaveBeenCalledWith(tenantB.tenantId, expect.anything(), expect.anything());
    expect(b.leads.intake).not.toHaveBeenCalledWith(connection.tenantId, expect.anything(), expect.anything());
  });

  it('processes a duplicate event only once', async () => {
    const { service, leads } = setup();
    await service.ingestZapierLead(request());
    await expect(service.ingestZapierLead(request())).resolves.toMatchObject({
      accepted: true, deduplicated: true,
    });
    expect(leads.intake).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid or revoked credentials before resolving a tenant', async () => {
    const { service } = setup();
    await expect(service.ingestZapierLead({ ...request(), authorization: 'Bearer invalid' })).rejects.toBeInstanceOf(UnauthorizedException);
    const previous = connection.status;
    connection.status = 'revoked';
    await expect(service.ingestZapierLead(request())).rejects.toBeInstanceOf(UnauthorizedException);
    connection.status = previous;
  });

  it('accepts an explicit controlled test only for the credential tenant', async () => {
    const { service, leads, testRuns } = setup();
    testRuns.findOne.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000030', tenantId: connection.tenantId,
      status: 'running', expiresAt: new Date(Date.now() + 60_000),
    });
    await service.ingestZapierLead({
      ...request(), testRunId: '00000000-0000-4000-8000-000000000030',
    });
    expect(testRuns.findOne).toHaveBeenCalledWith({ where: {
      id: '00000000-0000-4000-8000-000000000030', tenantId: connection.tenantId, status: 'running',
    } });
    expect(leads.intake).toHaveBeenCalledWith(
      connection.tenantId, expect.anything(),
      { source: 'zapier', controlledTest: true, testRunId: '00000000-0000-4000-8000-000000000030' },
    );
  });

  it('rejects mismatched event IDs and oversized metadata', async () => {
    const { service } = setup();
    await expect(service.ingestZapierLead({ ...request(), headerEventId: 'different' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.ingestZapierLead(request({ metadata: { value: 'x'.repeat(9_000) } }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('strict endpoint validation rejects a caller-supplied tenant ID', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({
      externalEventId: 'event-1', fullName: 'Jordan Buyer', email: 'jordan@example.com',
      tenantId: '00000000-0000-4000-8000-000000000099',
    }, { type: 'body', metatype: ZapierLeadIngressDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
