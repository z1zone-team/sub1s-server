export interface MostVisitedStationDto {
  stationId: string;
  stationName: string;
  visitCount: number;
}

export interface StatsBucketDto {
  /** KST 기준 키: WEEK, MONTH는 'YYYY-MM-DD', YEAR는 'YYYY-MM', ALL은 'YYYY' */
  key: string;
  distanceKm: number;
  rideCount: number;
}

export interface LineBreakdownDto {
  lineId: string;
  distanceKm: number;
  rideDurationSec: number;
}

export interface TravelStatsResponseDto {
  userId: string;
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  totalDistanceKm: number;
  totalTravelCount: number;
  transferCount: number;
  totalRideDurationSec: number;
  mostVisitedStations: MostVisitedStationDto[];
  mostUsedLineId?: string;
  /** 기간 안의 모든 구간을 0으로 채운 막대 (WEEK 일 7개, MONTH 일 1~말일, YEAR 월 12개, ALL 연도별) */
  buckets: StatsBucketDto[];
  /** 호선별 이동 거리·탑승 시간, 거리 내림차순. 경로 기록을 읽지 못한 이동은 제외 */
  lineBreakdown: LineBreakdownDto[];
}
