// Korea Standard Time helpers. KST is UTC+9 all year (no daylight saving), so everything is plain UTC arithmetic
// and gives the same result whatever time zone the server process runs in.
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface KstDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function toKstDate(at: Date | number): KstDate {
  const shifted = new Date((typeof at === 'number' ? at : at.getTime()) + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// The instant at which the given KST calendar date starts (00:00 KST). Out-of-range days and months roll over.
export function kstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

export function kstStartOfDay(at: Date | number): Date {
  const { year, month, day } = toKstDate(at);
  return kstMidnight(year, month, day);
}

export function kstStartOfMonth(year: number, month: number): Date {
  return kstMidnight(year, month, 1);
}

export function kstStartOfYear(year: number): Date {
  return kstMidnight(year, 1, 1);
}

// Midnight KST `days` calendar days after (or before, if negative) the KST day containing `at`.
export function kstAddDays(at: Date | number, days: number): Date {
  return new Date(kstStartOfDay(at).getTime() + days * MS_PER_DAY);
}

export function kstDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

// 'YYYY-MM-DD'
export function kstDayKey(at: Date | number): string {
  const { year, month, day } = toKstDate(at);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// 'YYYY-MM'
export function kstMonthKey(at: Date | number): string {
  const { year, month } = toKstDate(at);
  return `${year}-${pad2(month)}`;
}

// 'YYYY'
export function kstYearKey(at: Date | number): string {
  return String(toKstDate(at).year);
}

// ISO-8601 with the +09:00 offset and millisecond precision, e.g. '2026-10-11T14:30:00.000+09:00'.
// Every timestamp the server returns or stores goes through this, instead of Date#toISOString (which is UTC).
export function toKstIso(at: Date | number): string {
  const time = typeof at === 'number' ? at : at.getTime();
  if (Number.isNaN(time)) throw new RangeError('Invalid time value');
  return `${new Date(time + KST_OFFSET_MS).toISOString().slice(0, -1)}+09:00`;
}

export function kstNowIso(): string {
  return toKstIso(Date.now());
}

// Parses a client-sent ISO-8601 string. A value with an offset ('Z', '+09:00') is taken as written; a value
// without one ('2026-10-06T18:00:00', '2026-10-06') is read as KST, not as the server's local time.
// Returns an Invalid Date for unparseable input, like new Date().
export function parseIsoAsKst(value: string): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00+09:00`);
  }
  const timePart = trimmed.split('T')[1] ?? '';
  const hasOffset = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(timePart);
  return new Date(hasOffset ? trimmed : `${trimmed}+09:00`);
}
