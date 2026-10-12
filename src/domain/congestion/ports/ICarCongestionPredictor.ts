import { CongestionSource } from '../models/congestion';
import { CarCongestion } from '../services/car-congestion';

export const CAR_CONGESTION_PREDICTOR = Symbol('CAR_CONGESTION_PREDICTOR');

export type RateSource = CongestionSource;

export interface StationRate {
  ratePercent: number;
  source: RateSource;
}

export interface CarPrediction extends StationRate {
  cars: CarCongestion[];
}

/**
 * 열차가 역을 떠날 때 칸별 혼잡도를 예측한다. 지금은 서울시 통계 모델(`StatisticalCongestionProvider`)이
 * 구현하고, 실시간 센서 API가 열리면 같은 포트로 교체한다. 같은 입력에는 항상 같은 값을 돌려줘야 한다
 */
export interface ICarCongestionPredictor {
  predictCars(
    lineId: string,
    stationId: string,
    direction: string,
    atEpochMs: number,
    transferCars?: readonly number[],
  ): CarPrediction;
}
