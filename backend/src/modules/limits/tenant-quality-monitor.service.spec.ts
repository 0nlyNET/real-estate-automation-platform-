import { TenantQualityMonitorService } from './tenant-quality-monitor.service';

describe('TenantQualityMonitorService', () => {
  const service = new TenantQualityMonitorService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const metrics = (overrides: Record<string, number> = {}) => ({
    smsAttempts: 100,
    smsFailures: 0,
    smsLastHour: 0,
    emailAttempts: 100,
    emailBounces: 0,
    emailLastHour: 0,
    spamComplaints: 0,
    optOuts: 0,
    leadsLastHour: 0,
    prohibitedContentBlocks: 0,
    ...overrides,
  });

  it('keeps healthy traffic active', () => {
    expect(service.classify('tenant-1', metrics())).toMatchObject({
      severity: 'healthy',
      reasons: [],
    });
  });

  it('warns, pauses, and suspends at progressively serious thresholds', () => {
    expect(
      service.classify('tenant-1', metrics({ smsFailures: 10 })).severity,
    ).toBe('warning');
    expect(
      service.classify('tenant-1', metrics({ emailBounces: 5 })).severity,
    ).toBe('serious');
    expect(
      service.classify('tenant-1', metrics({ spamComplaints: 3 })).severity,
    ).toBe('extreme');
  });

  it('detects volume spikes and repeated prohibited content', () => {
    const report = service.classify(
      'tenant-1',
      metrics({ leadsLastHour: 250, prohibitedContentBlocks: 5 }),
    );
    expect(report.severity).toBe('serious');
    expect(report.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Lead volume'),
        expect.stringContaining('prohibited-content'),
      ]),
    );
  });
});
