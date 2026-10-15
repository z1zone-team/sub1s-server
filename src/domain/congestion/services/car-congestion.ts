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

// FNV-1a 32 bit. 같은 문자열은 항상 같은 값이고 서버를 다시 띄워도 달라지지 않는다
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

// 가장 한산한 칸. 값이 같은 칸이 여럿이면(1번과 마지막 칸은 위치 계수가 같아 늘 동률이다) 먼저 나온 칸으로
// 고정하지 않고 seed로 정해지는 순서로 고른다. 같은 seed와 같은 칸 목록이면 항상 같은 칸이라
// 경로 검색은 결정적이고, seed가 다른 역끼리는 1번과 마지막 칸이 섞여 나온다.
export function leastCrowdedCar<T extends { carNo: number; rate: number }>(
  cars: readonly T[],
  seed: string,
): T | undefined {
  if (cars.length === 0) return undefined;
  const lowest = Math.min(...cars.map((car) => car.rate));
  const tied = cars
    .filter((car) => Math.abs(car.rate - lowest) < 1e-9)
    .sort((a, b) => a.carNo - b.carNo);
  return tied[hash(seed) % tied.length];
}
