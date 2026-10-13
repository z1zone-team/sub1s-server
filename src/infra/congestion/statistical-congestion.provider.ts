import {
  CongestionSource,
  DayType,
  clampPercent,
  serviceTime,
  slotIndex,
} from '../../domain/congestion/models/congestion';
import {
  CarCongestion,
  predictCars,
} from '../../domain/congestion/services/car-congestion';
import { mockStationRate } from '../../domain/congestion/services/mock-congestion.model';
import {
  CarPrediction,
  ICarCongestionPredictor,
  RateSource,
  StationRate,
} from '../../domain/congestion/ports/ICarCongestionPredictor';
import { ICongestionProvider } from '../../domain/subway/ports/ICongestionProvider';

// 예전에는 이 파일이 정의했다. 포트로 옮겼지만 import 경로가 바뀌지 않도록 다시 내보낸다
export type { CarPrediction, RateSource, StationRate };

export interface CongestionRecordData {
  stationId: string;
  direction: string;
  dayType: DayType;
  // 30-minute average congestion in percent from the first slot (05:30)
  rates: readonly number[];
}

export interface CongestionData {
  records: readonly CongestionRecordData[];
}

type RatesByDirection = Map<string, readonly number[]>;

// Predicts how crowded a train is when it leaves a station at a given time. Seoul Metro statistics
// (lines 1 to 8, 30-minute averages by day type and direction) are used where they exist; everything else
// (other lines, other stations, hours without statistics) falls back to the ADR-005 model.
// The result is deterministic: the same input always gives the same congestion.
export class StatisticalCongestionProvider
  implements ICongestionProvider, ICarCongestionPredictor
{
  private readonly index: Record<DayType, Map<string, RatesByDirection>> = {
    WEEKDAY: new Map(),
    SATURDAY: new Map(),
    SUNDAY: new Map(),
  };

  constructor(data: CongestionData) {
    for (const record of data.records) {
      const stations = this.index[record.dayType];
      let directions = stations.get(record.stationId);
      if (!directions) {
        directions = new Map();
        stations.set(record.stationId, directions);
      }
      directions.set(record.direction, record.rates);
    }
  }

  getCongestion(
    lineId: string,
    fromStationId: string,
    _toStationId: string,
    direction: string,
    atEpochMs: number,
  ): number {
    return (
      this.stationRate(lineId, fromStationId, direction, atEpochMs)
        .ratePercent / 100
    );
  }

  stationRate(
    lineId: string,
    stationId: string,
    direction: string,
    atEpochMs: number,
  ): StationRate {
    const { dayType, minute } = serviceTime(atEpochMs);
    const slot = slotIndex(minute);
    if (slot !== undefined) {
      const published = this.published(dayType, stationId, direction, slot);
      if (published !== undefined) {
        return { ratePercent: clampPercent(published), source: 'STATISTICS' };
      }
    }
    return {
      ratePercent: mockStationRate(lineId, minute, dayType),
      source: 'MOCK',
    };
  }

  // Station rate spread over the cars of the train (cars next to a transfer stairway are the most crowded).
  predictCars(
    lineId: string,
    stationId: string,
    direction: string,
    atEpochMs: number,
    transferCars: readonly number[] = [],
    carCount?: number | null,
  ): CarPrediction {
    const rate = this.stationRate(lineId, stationId, direction, atEpochMs);
    // 칸 수를 모르는 노선은 없는 칸을 만들지 않는다
    if (carCount === null) return { ...rate, cars: [] };
    return {
      ...rate,
      cars: predictCars(rate.ratePercent, transferCars, carCount),
    };
  }

  // The published rate of the direction. A branch station can be listed under other direction names
  // (line 2 branches are 내선/외선), so without an exact match the station's other directions are averaged.
  private published(
    dayType: DayType,
    stationId: string,
    direction: string,
    slot: number,
  ): number | undefined {
    const directions = this.index[dayType].get(stationId);
    if (!directions) return undefined;
    const exact = directions.get(direction);
    if (exact) return exact[slot];
    let sum = 0;
    for (const rates of directions.values()) sum += rates[slot];
    return directions.size > 0 ? sum / directions.size : undefined;
  }
}
