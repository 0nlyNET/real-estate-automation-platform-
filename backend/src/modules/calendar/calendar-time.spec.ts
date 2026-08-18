import { BadRequestException } from '@nestjs/common';
import { assertIanaTimeZone, parseTenantDateTime } from './calendar-time';

describe('tenant calendar time parsing', () => {
  it('interprets datetime-local in the tenant IANA timezone', () => {
    expect(
      parseTenantDateTime('2026-01-15T09:30', 'America/New_York').toISOString(),
    ).toBe('2026-01-15T14:30:00.000Z');
  });

  it('rejects a nonexistent DST spring-forward wall time', () => {
    expect(() =>
      parseTenantDateTime('2026-03-08T02:30', 'America/New_York'),
    ).toThrow(/does not exist because of daylight-saving time/i);
  });

  it('requires an explicit offset for an ambiguous DST fall-back time', () => {
    expect(() =>
      parseTenantDateTime('2026-11-01T01:30', 'America/New_York'),
    ).toThrow(/occurs twice because of daylight-saving time/i);
    expect(
      parseTenantDateTime(
        '2026-11-01T01:30:00-04:00',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      parseTenantDateTime(
        '2026-11-01T01:30:00-05:00',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
  });

  it('rejects invalid tenant timezones', () => {
    expect(() => assertIanaTimeZone('US/Not-A-Zone')).toThrow(
      BadRequestException,
    );
  });
});
