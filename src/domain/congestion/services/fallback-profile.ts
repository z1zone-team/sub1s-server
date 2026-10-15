import { DayType, clampPercent } from '../models/congestion';
import { baseRate } from './mock-congestion.model';

// 통계가 없는 노선, 역, 시간의 폴백 추정에 쓰는 시간대 곡선.
// 서울교통공사 통계(1~8호선)를 요일별 30분 칸마다 평균 낸 값이며, 통계 값을 고치지 않고 따로 계산한 예측치다(ADR-005 3.3).
// 2026-10-15 호선 하나를 빼고 맞히는 검증에서 ADR-005 가정 곡선보다 평균 오차가 작았다
// (30분 칸 단위, 평일 18.8에서 14.3%p, 토 14.1에서 11.7%p, 일 13.1에서 8.1%p).
export interface ProfileRecord {
  stationId: string;
  dayType: DayType;
  // 첫 칸(05:30)부터 30분 평균 혼잡도(%)
  rates: readonly number[];
}

export interface FallbackProfile {
  // 요일별, 칸별 평균 혼잡도(%). 그 요일의 레코드가 없으면 키가 없다
  rates: Partial<Record<DayType, readonly number[]>>;
  // 곡선을 만든 레코드의 평균 호선 기저율. 호선 기저율을 곱할 때 평균 호선이 1배가 되도록 나눈다
  meanBaseRate: number;
}

// 역 ID는 `호선_역코드` 모양이다(예: 02_222)
function lineIdOf(stationId: string): string {
  return stationId.split('_')[0];
}

export function buildFallbackProfile(
  records: readonly ProfileRecord[],
): FallbackProfile {
  const sums: Partial<Record<DayType, number[]>> = {};
  const counts: Partial<Record<DayType, number[]>> = {};
  let baseSum = 0;

  for (const record of records) {
    const daySums = (sums[record.dayType] ??= []);
    const dayCounts = (counts[record.dayType] ??= []);
    record.rates.forEach((rate, slot) => {
      if (!Number.isFinite(rate)) return;
      daySums[slot] = (daySums[slot] ?? 0) + rate;
      dayCounts[slot] = (dayCounts[slot] ?? 0) + 1;
    });
    baseSum += baseRate(lineIdOf(record.stationId));
  }

  const rates: Partial<Record<DayType, readonly number[]>> = {};
  for (const dayType of Object.keys(sums) as DayType[]) {
    const daySums = sums[dayType] ?? [];
    const dayCounts = counts[dayType] ?? [];
    rates[dayType] = Array.from({ length: daySums.length }, (_, slot) =>
      dayCounts[slot] ? (daySums[slot] ?? 0) / dayCounts[slot] : NaN,
    );
  }

  return {
    rates,
    meanBaseRate: records.length > 0 ? baseSum / records.length : 1,
  };
}

// 곡선이 없는 요일이나 칸이면 undefined를 돌려주고, 호출한 쪽이 ADR-005 수식으로 대체한다
export function fallbackProfileRate(
  profile: FallbackProfile,
  lineId: string,
  dayType: DayType,
  slot: number,
): number | undefined {
  const average = profile.rates[dayType]?.[slot];
  if (average === undefined || !Number.isFinite(average)) return undefined;
  return clampPercent((average * baseRate(lineId)) / profile.meanBaseRate);
}
