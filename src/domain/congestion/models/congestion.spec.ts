import {
  clampPercent,
  congestionLevel,
  serviceTime,
  slotIndex,
} from './congestion';

// 2026-10-05 is a Monday, 2026-10-10 a Saturday, 2026-10-11 a Sunday (KST = UTC + 9)
const kst = (iso: string): Date => new Date(`${iso}+09:00`);

describe('serviceTime', () => {
  it('splits a KST date into the day type and the minute of the service day', () => {
    expect(serviceTime(kst('2026-10-05T08:15:00'))).toEqual({
      dayType: 'WEEKDAY',
      minute: 8 * 60 + 15,
    });
    expect(serviceTime(kst('2026-10-10T12:00:00'))).toEqual({
      dayType: 'SATURDAY',
      minute: 720,
    });
    expect(serviceTime(kst('2026-10-11T23:30:00'))).toEqual({
      dayType: 'SUNDAY',
      minute: 23 * 60 + 30,
    });
  });

  it('reads the instant in KST regardless of the server time zone', () => {
    // 2026-10-04T23:30:00Z is Monday 08:30 in Seoul
    expect(serviceTime(new Date('2026-10-04T23:30:00Z'))).toEqual({
      dayType: 'WEEKDAY',
      minute: 8 * 60 + 30,
    });
  });

  it('counts the time after midnight to the previous service day', () => {
    // Saturday 00:15 is still Friday's service
    expect(serviceTime(kst('2026-10-10T00:15:00'))).toEqual({
      dayType: 'WEEKDAY',
      minute: 24 * 60 + 15,
    });
    // Monday 00:15 is still Sunday's service
    expect(serviceTime(kst('2026-10-05T00:15:00'))).toEqual({
      dayType: 'SUNDAY',
      minute: 24 * 60 + 15,
    });
  });

  it('starts the service day at 05:30', () => {
    expect(serviceTime(kst('2026-10-05T05:29:00')).dayType).toBe('SUNDAY');
    expect(serviceTime(kst('2026-10-05T05:30:00'))).toEqual({
      dayType: 'WEEKDAY',
      minute: 330,
    });
  });
});

describe('slotIndex', () => {
  it('maps minutes to 30-minute slots from 05:30', () => {
    expect(slotIndex(330)).toBe(0);
    expect(slotIndex(359)).toBe(0);
    expect(slotIndex(360)).toBe(1);
    expect(slotIndex(8 * 60 + 45)).toBe(6);
    expect(slotIndex(24 * 60 + 45)).toBe(38); // 24:30~25:00 is the last slot
  });

  it('has no slot when no train runs', () => {
    expect(slotIndex(329)).toBeUndefined();
    expect(slotIndex(25 * 60)).toBeUndefined();
    expect(slotIndex(28 * 60)).toBeUndefined();
  });
});

describe('congestionLevel', () => {
  it('uses the ADR-005 thresholds', () => {
    expect(congestionLevel(0)).toBe('여유');
    expect(congestionLevel(34.99)).toBe('여유');
    expect(congestionLevel(35)).toBe('보통');
    expect(congestionLevel(70)).toBe('보통');
    expect(congestionLevel(70.01)).toBe('혼잡');
  });
});

describe('clampPercent', () => {
  it('keeps a rate within 0 and 100', () => {
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(123.9)).toBe(100);
    expect(clampPercent(42)).toBe(42);
  });
});
