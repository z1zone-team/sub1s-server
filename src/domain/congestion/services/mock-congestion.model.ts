import { DayType, clampPercent } from '../models/congestion';

// ADR-005 3.1: the model for lines and stations that have no published statistics.
// Congestion = C_base x BaseRate(line) x Peak(time), without the random noise (route search must be deterministic).
// The provider uses this only where it has no average statistics curve for the day type (see fallback-profile.ts),
// that is when no train runs or the statistics file has no records for the day type.
export const BASE_CONGESTION_PERCENT = 35;

const BASE_RATE_BY_LINE: Record<string, number> = {
  '02': 1.3,
  '09': 1.3,
  '03': 1.05,
  '07': 1.05,
  SB: 1.05,
  '01': 1.0,
  '04': 1.0,
  '05': 1.0,
};
const DEFAULT_BASE_RATE = 0.75;

export function baseRate(lineId: string): number {
  return BASE_RATE_BY_LINE[lineId] ?? DEFAULT_BASE_RATE;
}

// ADR-005 gives a range for each period. The middle of each range is used and the gaps between periods
// are filled by straight lines:
//   night 23:00-06:30 0.25-0.45 -> 0.35, morning peak 07:30-09:00 1.90-2.30 -> 2.10,
//   daytime 10:00-17:00 0.85-1.05 -> 0.95, evening peak 18:00-19:30 1.75-2.10 -> 1.925
const PEAK_POINTS: readonly (readonly [number, number])[] = [
  [0, 0.35],
  [6 * 60 + 30, 0.35],
  [7 * 60 + 30, 2.1],
  [9 * 60, 2.1],
  [10 * 60, 0.95],
  [17 * 60, 0.95],
  [18 * 60, 1.925],
  [19 * 60 + 30, 1.925],
  [23 * 60, 0.35],
  [48 * 60, 0.35],
];

// weekends have no commuter peak; the factor never exceeds the top of the daytime range
const WEEKEND_PEAK_CAP = 1.05;

export function peakFactor(minute: number, dayType: DayType): number {
  let factor = PEAK_POINTS[PEAK_POINTS.length - 1][1];
  for (let i = 1; i < PEAK_POINTS.length; i += 1) {
    const [x0, y0] = PEAK_POINTS[i - 1];
    const [x1, y1] = PEAK_POINTS[i];
    if (minute <= x1) {
      factor = y0 + ((y1 - y0) * (minute - x0)) / (x1 - x0);
      break;
    }
  }
  return dayType === 'WEEKDAY' ? factor : Math.min(factor, WEEKEND_PEAK_CAP);
}

// station-level congestion in percent (average car)
export function mockStationRate(
  lineId: string,
  minute: number,
  dayType: DayType,
): number {
  return clampPercent(
    BASE_CONGESTION_PERCENT * baseRate(lineId) * peakFactor(minute, dayType),
  );
}
