type TzParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getTzParts(date: Date, timeZone: string): TzParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function isValidIanaTimeZone(timeZone?: string | null): boolean {
  const value = String(timeZone || '').trim();
  if (!value || !value.includes('/')) return value === 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the offset (in ms) between the provided timezone wall-clock and UTC at the given instant.
 */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getTzParts(date, timeZone);
  const tzWallClockAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return tzWallClockAsUtc - date.getTime();
}

export function parseHHMM(v?: string): { hour: number; minute: number } | null {
  if (!v) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function minutesSinceMidnight(h: number, m: number): number {
  return h * 60 + m;
}

export function formatHHMM(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.trunc(totalMinutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function isWithinQuietHours(opts: {
  now: Date;
  timeZone: string;
  quietStart?: string;
  quietEnd?: string;
}): boolean {
  const start = parseHHMM(opts.quietStart);
  const end = parseHHMM(opts.quietEnd);
  if (!start || !end) return false;

  const p = getTzParts(opts.now, opts.timeZone);
  const nowMin = minutesSinceMidnight(p.hour, p.minute);
  const startMin = minutesSinceMidnight(start.hour, start.minute);
  const endMin = minutesSinceMidnight(end.hour, end.minute);

  // Non-overnight: e.g. 22:00 -> 06:00 would be overnight (startMin > endMin)
  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Overnight: quiet from start -> midnight and midnight -> end
  return nowMin >= startMin || nowMin < endMin;
}

export function nextAllowedSendTime(opts: {
  now: Date;
  timeZone: string;
  quietStart?: string;
  quietEnd?: string;
}): Date {
  // If not in quiet hours, send now
  if (!isWithinQuietHours(opts)) return opts.now;

  const end = parseHHMM(opts.quietEnd);
  if (!end) return opts.now;

  const nowParts = getTzParts(opts.now, opts.timeZone);
  // Schedule for today at quietEnd in that timezone. If already past, schedule next day.
  const nowMin = minutesSinceMidnight(nowParts.hour, nowParts.minute);
  const endMin = minutesSinceMidnight(end.hour, end.minute);

  let year = nowParts.year;
  let month = nowParts.month;
  let day = nowParts.day;
  if (nowMin >= endMin) {
    const nextCalendarDay = new Date(Date.UTC(year, month - 1, day + 1));
    year = nextCalendarDay.getUTCFullYear();
    month = nextCalendarDay.getUTCMonth() + 1;
    day = nextCalendarDay.getUTCDate();
  }

  return zonedWallClockToDate(
    { year, month, day, hour: end.hour, minute: end.minute, second: 0 },
    opts.timeZone,
  );
}

function zonedWallClockToDate(parts: TzParts, timeZone: string): Date {
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = wallClockUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(candidate), timeZone);
    const adjusted = wallClockUtc - offset;
    if (adjusted === candidate) break;
    candidate = adjusted;
  }
  return new Date(candidate);
}
