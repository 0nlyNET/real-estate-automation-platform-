import { BadRequestException } from '@nestjs/common';

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

export function assertIanaTimeZone(value: string): string {
  const timeZone = String(value || '').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new BadRequestException('Choose a valid IANA time zone before scheduling.');
  }
}

function partsAt(instantMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function sameWallClock(a: WallClock, b: WallClock) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function offsetAt(instantMs: number, timeZone: string) {
  const parts = partsAt(instantMs, timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - Math.floor(instantMs / 1_000) * 1_000
  );
}

/**
 * Parses an absolute RFC3339 timestamp, or interprets a datetime-local value in
 * the tenant's IANA time zone. Non-existent DST wall times are rejected and
 * ambiguous fall-back times must include an explicit UTC offset.
 */
export function parseTenantDateTime(value: string, tenantTimeZone: string): Date {
  const input = String(value || '').trim();
  const timeZone = assertIanaTimeZone(tenantTimeZone);
  if (/Z$|[+-]\d{2}:\d{2}$/.test(input)) {
    const absolute = new Date(input);
    if (Number.isNaN(absolute.getTime())) {
      throw new BadRequestException('Enter a valid appointment date and time.');
    }
    return absolute;
  }

  const match = LOCAL_DATE_TIME.exec(input);
  if (!match) {
    throw new BadRequestException(
      'Use an RFC3339 timestamp or a local date and time for the workspace time zone.',
    );
  }
  const wall: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const normalized = new Date(wallAsUtc);
  if (
    normalized.getUTCFullYear() !== wall.year ||
    normalized.getUTCMonth() + 1 !== wall.month ||
    normalized.getUTCDate() !== wall.day ||
    normalized.getUTCHours() !== wall.hour ||
    normalized.getUTCMinutes() !== wall.minute ||
    normalized.getUTCSeconds() !== wall.second
  ) {
    throw new BadRequestException('Enter a valid calendar date and time.');
  }

  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetAt(wallAsUtc + hours * 60 * 60_000, timeZone));
  }
  const candidates = [...offsets]
    .map((offset) => wallAsUtc - offset)
    .filter((instant, index, all) => all.indexOf(instant) === index)
    .filter((instant) => sameWallClock(partsAt(instant, timeZone), wall));

  if (!candidates.length) {
    throw new BadRequestException(
      'That local time does not exist because of daylight-saving time. Choose another time.',
    );
  }
  if (candidates.length > 1) {
    throw new BadRequestException(
      'That local time occurs twice because of daylight-saving time. Include an explicit UTC offset.',
    );
  }
  return new Date(candidates[0]);
}
