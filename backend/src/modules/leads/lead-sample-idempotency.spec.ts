import { FindOperator } from 'typeorm';
import { Lead } from './lead.entity';
import { LeadsService } from './leads.service';

const TENANT = { id: '9f3a2c1d-0000-4000-8000-000000000000', lifecycleStatus: 'ACTIVE' } as any;

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function serviceFor(store: Lead[]) {
  const leadsRepo = {
    count: jest.fn(async ({ where }: any) => {
      const conds = Array.isArray(where) ? where : [where];
      return store.filter((lead) =>
        conds.some((cond) =>
          Object.entries(cond).every(([key, value]) => {
            if (value instanceof FindOperator) {
              if (value.type === 'like') {
                return likeToRegExp(String(value.value)).test(String((lead as any)[key] ?? ''));
              }
              return false;
            }
            return (lead as any)[key] === value;
          }),
        ),
      ).length;
    }),
    create: jest.fn((value: any) => Object.assign(new Lead(), { id: `lead-${store.length + 1}`, ...value })),
    save: jest.fn(async (value: any) => {
      if (!store.includes(value)) store.push(value);
      return value;
    }),
  };
  const eventsRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const tenantsService = { findById: jest.fn(async (id: string) => (id === TENANT.id ? TENANT : null)) };
  const service = new LeadsService(
    leadsRepo as any,
    eventsRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    tenantsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, leadsRepo, store };
}

describe('sample lead seeding idempotency (M7)', () => {
  it('seeds 8 leads on the first run and none on the second', async () => {
    const { service, store } = serviceFor([]);

    const first = await service.createSampleLeads(TENANT.id);
    expect(first).toHaveLength(8);
    expect(store).toHaveLength(8);

    const second = await service.createSampleLeads(TENANT.id);
    expect(second).toEqual([]);
    expect(store).toHaveLength(8);
  });

  it('skips seeding entirely when any sample lead already exists', async () => {
    const { service, store } = serviceFor([]);
    // Simulate a partial prior seeding (e.g. interrupted run): only one of
    // the 8 sample leads exists. The documented behavior is to skip the whole
    // batch rather than backfill the missing ones.
    const partial = Object.assign(new Lead(), {
      id: 'existing-sample',
      tenantId: TENANT.id,
      fullName: 'Ava Johnson',
      email: `sample+${TENANT.id.slice(0, 6)}-1234567890-0@realtytechai.dev`,
    });
    store.push(partial);

    const result = await service.createSampleLeads(TENANT.id);
    expect(result).toEqual([]);
    expect(store).toHaveLength(1);
  });

  it('does not mistake another tenant or non-sample leads for existing samples', async () => {
    const { service, store } = serviceFor([]);
    const otherTenantLead = Object.assign(new Lead(), {
      id: 'other-tenant-sample',
      tenantId: 'different-tenant',
      email: `sample+${TENANT.id.slice(0, 6)}-1234567890-0@realtytechai.dev`,
    });
    const realLead = Object.assign(new Lead(), {
      id: 'real-lead',
      tenantId: TENANT.id,
      email: 'buyer@example.com',
    });
    store.push(otherTenantLead, realLead);

    const result = await service.createSampleLeads(TENANT.id);
    expect(result).toHaveLength(8);
    expect(store).toHaveLength(10);
  });
});
