export type DayType = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY';
export type CongestionLevel = '여유' | '보통' | '혼잡';

// 30-minute slots from 05:30 to 25:00, as published by Seoul Metro
export const SLOT_COUNT = 39;
export const SLOT_MINUTES = 30;
export const FIRST_SLOT_MINUTE = 5 * 60 + 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = MINUTES_PER_DAY * 60 * 1000;

export interface ServiceTime {
  dayType: DayType;
  // minutes since 00:00 of the service day. After midnight it continues past 1440 (00:15 is 1455).
  minute: number;
}

// The service day starts at 05:30 (KST). Times before that belong to the previous day's service.
// Public holidays are not known here and are treated as the weekday they fall on.
export function serviceTime(at: Date | number): ServiceTime {
  const kstMs = (typeof at === 'number' ? at : at.getTime()) + KST_OFFSET_MS;
  const dayNumber = Math.floor(kstMs / MS_PER_DAY);
  // 1970-01-01 was a Thursday
  let weekday = (dayNumber + 4) % 7;
  let minute = Math.floor((kstMs - dayNumber * MS_PER_DAY) / 60000);
  if (minute < FIRST_SLOT_MINUTE) {
    weekday = (weekday + 6) % 7;
    minute += MINUTES_PER_DAY;
  }
  const dayType: DayType =
    weekday === 0 ? 'SUNDAY' : weekday === 6 ? 'SATURDAY' : 'WEEKDAY';
  return { dayType, minute };
}

// undefined when no train runs (after 25:00 until 05:30)
export function slotIndex(minute: number): number | undefined {
  const index = Math.floor((minute - FIRST_SLOT_MINUTE) / SLOT_MINUTES);
  return index >= 0 && index < SLOT_COUNT ? index : undefined;
}

// 여유 below 35%, 보통 35% to 70%, 혼잡 above 70% (ADR-005 3.2)
export function congestionLevel(ratePercent: number): CongestionLevel {
  if (ratePercent < 35) return '여유';
  if (ratePercent <= 70) return '보통';
  return '혼잡';
}

export function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
