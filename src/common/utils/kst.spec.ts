import {
  KST_OFFSET_MS,
  kstAddDays,
  kstDayKey,
  kstDaysInMonth,
  kstMidnight,
  kstMonthKey,
  kstStartOfDay,
  kstStartOfMonth,
  kstStartOfYear,
  kstNowIso,
  kstYearKey,
  toKstDate,
  toKstIso,
} from './kst';

describe('kst', () => {
  // 2026-11-01 00:30 KST is 2026-10-31 15:30 UTC: the case a UTC server gets wrong.
  const justAfterKstMidnight = new Date('2026-10-31T15:30:00Z');
  // 2026-10-31 23:59:59 KST is 2026-10-31 14:59:59 UTC.
  const justBeforeKstMidnight = new Date('2026-10-31T14:59:59Z');

  it('reads the calendar date in KST, not in UTC', () => {
    expect(toKstDate(justAfterKstMidnight)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(toKstDate(justBeforeKstMidnight)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it('builds day, month and year keys in KST', () => {
    expect(kstDayKey(justAfterKstMidnight)).toBe('2026-11-01');
    expect(kstMonthKey(justAfterKstMidnight)).toBe('2026-11');
    expect(kstMonthKey(justBeforeKstMidnight)).toBe('2026-10');
    expect(kstYearKey(new Date('2025-12-31T15:00:00Z'))).toBe('2026');
  });

  it('crosses the year boundary in KST', () => {
    expect(kstDayKey(new Date('2025-12-31T14:59:59Z'))).toBe('2025-12-31');
    expect(kstDayKey(new Date('2025-12-31T15:00:00Z'))).toBe('2026-01-01');
  });

  it('returns the instant a KST day, month and year start', () => {
    expect(kstMidnight(2026, 11, 1).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(kstStartOfDay(justAfterKstMidnight).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(kstStartOfMonth(2026, 10).toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(kstStartOfYear(2026).toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('rolls months over so the end of a month is the start of the next', () => {
    expect(kstStartOfMonth(2026, 13).toISOString()).toBe(kstStartOfYear(2027).toISOString());
  });

  it('adds calendar days from the KST midnight', () => {
    expect(kstAddDays(new Date('2026-10-11T03:00:00Z'), -6).toISOString()).toBe(
      '2026-10-04T15:00:00.000Z',
    );
    expect(kstAddDays(justAfterKstMidnight, 1).toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('counts the days of a month including leap years', () => {
    expect(kstDaysInMonth(2026, 10)).toBe(31);
    expect(kstDaysInMonth(2026, 2)).toBe(28);
    expect(kstDaysInMonth(2028, 2)).toBe(29);
    expect(kstDaysInMonth(2026, 12)).toBe(31);
  });

  describe('toKstIso', () => {
    it('formats the instant with the +09:00 offset and milliseconds', () => {
      expect(toKstIso(new Date('2026-10-11T05:30:15.123Z'))).toBe('2026-10-11T14:30:15.123+09:00');
      expect(toKstIso(justAfterKstMidnight)).toBe('2026-11-01T00:30:00.000+09:00');
    });

    it('keeps the same instant as the UTC form', () => {
      const original = new Date('2026-10-11T05:30:15.123Z');
      expect(new Date(toKstIso(original)).getTime()).toBe(original.getTime());
    });

    it('accepts epoch milliseconds and crosses the year boundary', () => {
      expect(toKstIso(Date.parse('2025-12-31T15:00:00Z'))).toBe('2026-01-01T00:00:00.000+09:00');
    });

    it('rejects an invalid date like toISOString does', () => {
      expect(() => toKstIso(new Date('not-a-date'))).toThrow(RangeError);
    });

    it('kstNowIso is the current instant in KST form', () => {
      const before = Date.now();
      const now = kstNowIso();
      expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/);
      expect(new Date(now).getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  it('exposes the KST offset as nine hours', () => {
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000);
  });
});
