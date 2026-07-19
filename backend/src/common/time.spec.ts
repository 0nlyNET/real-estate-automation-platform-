import {
  formatHHMM,
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
});
