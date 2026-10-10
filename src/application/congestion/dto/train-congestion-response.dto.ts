import {
  CongestionLevel,
  CongestionSource,
} from '../../../domain/congestion/models/congestion';

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
  source: CongestionSource; // STATISTICS: 공표 통계, MOCK: 통계가 없는 역의 추정값
  cars: CarCongestionDto[];
  updatedAt: string; // ISO-8601
}
