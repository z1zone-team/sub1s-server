import { RouteMode } from '../../../domain/subway/models/route';
import { CongestionLevel } from '../../../domain/congestion/models/congestion';

export interface PathSegmentDto {
  lineId: string;
  direction: 'UP' | 'DOWN' | 'INNER' | 'OUTER';
  isExpress: boolean;
  fromStationId: string;
  fromStationName: string;
  toStationId: string;
  toStationName: string;
  stationCount: number;
  durationSec: number;
  distanceKm: number;
  recommendedCarNo: number;
  isWeakAirConditioned: boolean;
  congestionLevel: CongestionLevel;
  congestionRate: number;
  isEstimated?: boolean;
}

export interface SubwayRouteOptionDto {
  mode: RouteMode;
  totalDurationSec: number;
  totalDistanceKm: number;
  totalFare: number;
  transferCount: number;
  estimatedArrivalTimestamp: string; // ISO-8601
  segments: PathSegmentDto[];
}

export interface RouteSearchResultDto {
  options: SubwayRouteOptionDto[];
  aiBriefingText?: string;
}
