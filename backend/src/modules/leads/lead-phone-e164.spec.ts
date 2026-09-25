import { FindOperator } from 'typeorm';
import { Lead } from './lead.entity';
import { LeadsService } from './leads.service';
import { LeadPhoneE164Backfill1790208000001 } from '../../database/migrations/202609240001-lead-phone-e164-backfill';

const TENANT = { id: 'tenant-a', lifecycleStatus: 'ACTIVE' } as any;

function matchesWhere(lead: any, where: any): boolean {
  const conds = Array.isArray(where) ? where : [where];
  return conds.some((cond) =>
    Object.entries(cond).every(([key, value]) => {
      if (value instanceof FindOperator) {
        if (value.type === 'isNull') return lead[key] === null || lead[key] === undefined;
        return false;
      }
      return lead[key] === value;
    }),
  );
}

function serviceFor(store: Lead[]) {
  const leadsRepo = {
    findOne: jest.fn(async ({ where }: any) => store.find((l) => matchesWhere(l, where)) || null),
    create: jest.fn((value: any) => Object.assign(new Lead(), { id: `lead-${store.length + 1}`, ...value })),
    save: jest.fn(async (value: any) => {
      if (!store.includes(value)) store.push(value);
      return value;
    }),
  };
  const eventsRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const stageRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const usersRepo = { findOne: jest.fn() };
  const teamsRepo = { findOne: jest.fn() };
  const settingsRepo = { findOne: jest.fn(async () => null) };
  const tenantsService = { findById: jest.fn(async (id: string) => (id === TENANT.id ? TENANT : null)) };
  const complianceService = { recordLeadConsent: jest.fn(async () => undefined) };
  const messagingService = { queueInstantResponses: jest.fn(async () => undefined) };
  const sequencesService = { startForLead: jest.fn(async () => undefined) };
  const routingService = { routeLead: jest.fn(async () => null) };
  const service = new LeadsService(
    leadsRepo as any,
    eventsRepo as any,
    stageRepo as any,
    usersRepo as any,
    settingsRepo as any,
    teamsRepo as any,
    tenantsService as any,
    messagingService as any,
    sequencesService as any,
    routingService as any,
    complianceService as any,
    undefined, // notifications
    undefined, // limits
    undefined, // dataSource -> withDedupLock runs the callback directly
  );
  return { service, leadsRepo, eventsRepo, tenantsService };
}

const intakePayload = (overrides: any = {}) => ({
  fullName: 'Jane Doe',
  phone: '(555) 123-4567',
  source: 'Website',
  ...overrides,
});

describe('lead phone E164 canonicalization (H1)', () => {
  it('stores the intake phone in E164 form instead of bare digits', async () => {
    const { service, leadsRepo } = serviceFor([]);
    const saved = await service.intake('tenant-a', intakePayload() as any);
    expect(leadsRepo.save).toHaveBeenCalledTimes(1);
    expect(saved.phone).toBe('+15551234567');
  });

  it('dedups intake against a provider-ingested E164 lead (cross-path)', async () => {
    // Provider ingestion (zillow/realtor adapters via normalizePhoneNumber)
    // stores '+15551234567'; the old intake path stored '15551234567' and
    // missed the match. Both paths now store E164 so exact-equality dedup hits.
    const providerLead = Object.assign(new Lead(), {
      id: 'provider-lead-1',
      tenantId: 'tenant-a',
      fullName: 'Jane Doe',
      phone: '+15551234567',
      testRunId: null,
    });
    const { service, leadsRepo, eventsRepo } = serviceFor([providerLead]);

    const result = await service.intake('tenant-a', intakePayload({ phone: '5551234567' }) as any);

    expect(result.id).toBe('provider-lead-1');
    expect(leadsRepo.save).not.toHaveBeenCalled();
    expect(eventsRepo.save).toHaveBeenCalledTimes(1);
  });

  it('drops phone values that cannot form a valid E164 number', async () => {
    const { service } = serviceFor([]);
    const saved = await service.intake('tenant-a', intakePayload({ phone: '123' }) as any);
    expect(saved.phone).toBeUndefined();
  });

  it('returns the existing lead when the insert races a unique violation (23505)', async () => {
    const existing = Object.assign(new Lead(), {
      id: 'race-winner',
      tenantId: 'tenant-a',
      fullName: 'Jane Doe',
      phone: '+15551234567',
      testRunId: null,
    });
    const { service, leadsRepo } = serviceFor([]);
    leadsRepo.save.mockRejectedValueOnce({ code: '23505' });
    // Pre-check misses, the concurrent insert wins the race, then the
    // post-violation lookup finds the row and returns it instead of 500ing.
    const liveStore: Lead[] = [];
    let preCheckDone = false;
    leadsRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (!preCheckDone) {
        preCheckDone = true;
        liveStore.push(existing); // the racing insert commits in between
      }
      return liveStore.find((l) => matchesWhere(l, where)) || null;
    });

    const result = await service.intake('tenant-a', intakePayload() as any);
    expect(result.id).toBe('race-winner');
  });

  it('rethrows save errors that are not unique violations', async () => {
    const { service } = serviceFor([]);
    // findOne returns null for the pre-check, save throws a non-23505 error.
    (service as any).leadsRepository.findOne = jest.fn(async () => null);
    (service as any).leadsRepository.save = jest.fn(async () => {
      throw new Error('connection lost');
    });
    await expect(service.intake('tenant-a', intakePayload() as any)).rejects.toThrow('connection lost');
  });
});

describe('lead phone E164 backfill migration', () => {
  it('rewrites only bare-digit phones, leaving NULLs and E164 values alone', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
    const migration = new LeadPhoneE164Backfill1790208000001();
    await migration.up(runner as any);
    const upSql = queries.join('\n');
    expect(upSql).toContain('UPDATE "leads"');
    expect(upSql).toContain(`SET "phone" = '+' || "phone"`);
    expect(upSql).toContain('"phone" IS NOT NULL');
    expect(upSql).toContain(`"phone" NOT LIKE '+%'`);
    expect(upSql).toContain(`"phone" ~ '^[0-9]{8,15}$'`);
  });

  it('down() is a safe no-op so re-running up() stays idempotent', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
    const migration = new LeadPhoneE164Backfill1790208000001();
    await migration.up(runner as any);
    await migration.down(runner as any);
    await migration.up(runner as any);
    const upStatements = queries.filter((q) => q.includes('UPDATE "leads"'));
    expect(upStatements).toHaveLength(2);
    expect(upStatements[0]).toBe(upStatements[1]);
  });
});
