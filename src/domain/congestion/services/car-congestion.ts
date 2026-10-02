import {
  CongestionLevel,
  clampPercent,
  congestionLevel,
} from '../models/congestion';

export interface CarCongestion {
  carNo: number;
  // percent, 0 to 100
  rate: number;
  level: CongestionLevel;
}

// ADR-005 3.1 location factors, using the middle of each range:
// cars next to a transfer stairway 1.35-1.50, ordinary cars 1.00, the end cars 0.70-0.85
export const TRANSFER_CAR_FACTOR = 1.425;
export const NORMAL_CAR_FACTOR = 1.0;
export const END_CAR_FACTOR = 0.775;
export const DEFAULT_CAR_COUNT = 10;

export function carLocationFactor(
  carNo: number,
  transferCars: readonly number[] = [],
  carCount = DEFAULT_CAR_COUNT,
): number {
  if (transferCars.includes(carNo)) return TRANSFER_CAR_FACTOR;
  if (carNo === 1 || carNo === carCount) return END_CAR_FACTOR;
  return NORMAL_CAR_FACTOR;
}

// Spreads a station-level congestion over the cars of a train. transferCars are the cars connected to a
// transfer stairway at the station (not collected yet, so callers may pass an empty list).
export function predictCars(
  stationRatePercent: number,
  transferCars: readonly number[] = [],
  carCount = DEFAULT_CAR_COUNT,
): CarCongestion[] {
  return Array.from({ length: carCount }, (_, i) => {
    const carNo = i + 1;
    const rate = clampPercent(
      stationRatePercent * carLocationFactor(carNo, transferCars, carCount),
    );
    return { carNo, rate, level: congestionLevel(rate) };
  });
}
