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
    hour12: false,
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

/**
 * Returns the offset (in ms) between the provided timezone wall-clock and UTC at the given instant.
 * This is an approximation without external timezone libraries, but it is good enough for quiet-hours gating.
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
  const offsetMs = getTimeZoneOffsetMs(opts.now, opts.timeZone);

  // Schedule for today at quietEnd in that timezone. If already past, schedule next day.
  const nowMin = minutesSinceMidnight(nowParts.hour, nowParts.minute);
  const endMin = minutesSinceMidnight(end.hour, end.minute);

  let year = nowParts.year;
  let month = nowParts.month;
  let day = nowParts.day;
  if (nowMin >= endMin) {
    const tmp = new Date(Date.UTC(year, month - 1, day, 12, 0, 0) - offsetMs);
    tmp.setUTCDate(tmp.getUTCDate() + 1);
    const p2 = getTzParts(tmp, opts.timeZone);
    year = p2.year;
    month = p2.month;
    day = p2.day;
  }

  const wallUtc = Date.UTC(year, month - 1, day, end.hour, end.minute, 0);
  const actual = wallUtc - offsetMs;
  return new Date(actual);
}
