// KST는 서머타임이 없는 UTC+9라 서버 시간대와 무관하게 UTC 산술로만 계산한다
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface KstDate {
  year: number;
  month: number;
  day: number;
}

export function toKstDate(at: Date | number): KstDate {
  const shifted = new Date((typeof at === 'number' ? at : at.getTime()) + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** KST의 시각(0~23) */
export function kstHour(at: Date | number): number {
  return new Date((typeof at === 'number' ? at : at.getTime()) + KST_OFFSET_MS).getUTCHours();
}

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

export function kstAddDays(at: Date | number, days: number): Date {
  return new Date(kstStartOfDay(at).getTime() + days * MS_PER_DAY);
}

export function kstDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function kstDayKey(at: Date | number): string {
  const { year, month, day } = toKstDate(at);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function kstMonthKey(at: Date | number): string {
  const { year, month } = toKstDate(at);
  return `${year}-${pad2(month)}`;
}

export function kstYearKey(at: Date | number): string {
  return String(toKstDate(at).year);
}

// 응답과 저장에 쓰는 시각은 toISOString()(UTC) 대신 항상 이 함수를 쓴다
export function toKstIso(at: Date | number): string {
  const time = typeof at === 'number' ? at : at.getTime();
  if (Number.isNaN(time)) throw new RangeError('Invalid time value');
  return `${new Date(time + KST_OFFSET_MS).toISOString().slice(0, -1)}+09:00`;
}

export function kstNowIso(): string {
  return toKstIso(Date.now());
}

// 클라이언트가 보낸 오프셋 없는 시각은 서버 시간대가 아닌 KST로 해석한다
export function parseIsoAsKst(value: string): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00+09:00`);
  }
  const timePart = trimmed.split('T')[1] ?? '';
  const hasOffset = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(timePart);
  return new Date(hasOffset ? trimmed : `${trimmed}+09:00`);
}
