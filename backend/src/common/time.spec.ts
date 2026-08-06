import {
  formatHHMM,
  isValidIanaTimeZone,
  isWithinQuietHours,
  nextAllowedSendTime,
  parseHHMM,
} from './time';

describe('quiet-hours helpers', () => {
  it('validates and formats HH:MM values', () => {
    expect(parseHHMM('23:15')).toEqual({ hour: 23, minute: 15 });
    expect(parseHHMM('24:00')).toBeNull();
    expect(formatHHMM(75)).toBe('01:15');
  });

  it('handles overnight quiet hours in the tenant timezone', () => {
    expect(isWithinQuietHours({
      now: new Date('2026-07-18T03:00:00.000Z'),
      timeZone: 'UTC',
      quietStart: '22:00',
      quietEnd: '06:00',
    })).toBe(true);
    expect(isWithinQuietHours({
      now: new Date('2026-07-18T12:00:00.000Z'),
      timeZone: 'UTC',
      quietStart: '22:00',
      quietEnd: '06:00',
    })).toBe(false);
  });

  it('reschedules work to the end of quiet hours', () => {
    expect(
      nextAllowedSendTime({
        now: new Date('2026-07-18T03:00:00.000Z'),
        timeZone: 'UTC',
        quietStart: '22:00',
        quietEnd: '06:00',
      }).toISOString(),
    ).toBe('2026-07-18T06:00:00.000Z');
  });

  it('uses an inclusive start and exclusive end boundary', () => {
    const base = {
      timeZone: 'UTC',
      quietStart: '22:00',
      quietEnd: '06:00',
    };
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-08-06T21:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-08-06T22:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-08-07T05:59:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-08-07T06:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('handles the spring daylight-saving transition in an IANA zone', () => {
    const base = {
      timeZone: 'America/New_York',
      quietStart: '01:00',
      quietEnd: '03:00',
    };
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-03-08T06:59:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours({
        ...base,
        now: new Date('2026-03-08T07:00:00.000Z'),
      }),
    ).toBe(false);
    expect(
      nextAllowedSendTime({
        ...base,
        now: new Date('2026-03-08T06:30:00.000Z'),
      }).toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
  });

  it('validates IANA time-zone identifiers without falling back to UTC', () => {
    expect(isValidIanaTimeZone('America/New_York')).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
  });
});
