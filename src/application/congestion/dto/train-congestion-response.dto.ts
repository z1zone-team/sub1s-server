import { CongestionLevel } from '../../../domain/congestion/models/congestion';

export interface CarCongestionDto {
  carNo: number; // 1 ~ 10
  rate: number; // 0 ~ 100
  level: CongestionLevel;
  isWeakAirConditioned: boolean;
}

export interface TrainCongestionResponseDto {
  lineId: string;
  trainId: string;
  stationId: string;
  averageRate: number;
  cars: CarCongestionDto[];
  updatedAt: string; // ISO-8601
}
