/**
 * 다른 사용자의 이동 기록 응답.
 * 지금은 앱이 내 기록 화면을 그대로 쓸 수 있게 내 기록 응답과 필드가 같다.
 * 보안 정책에 따라 필드를 줄일 수 있도록 내 기록 DTO를 재사용하지 않고 따로 둔다.
 * 필드를 빼면 UserTravelService의 변환 함수에서도 같이 뺀다
 */

export interface UserTimelineLogItemDto {
  id: string;
  originStationName: string;
  destStationName: string;
  distanceKm: number;
  traveledAt: string; // ISO-8601, KST(+09:00)
  /** 이용한 호선 순서대로 (도보 제외). 경로 기록을 읽지 못하면 출발역의 호선 */
  lineIds: string[];
  /** 급행 구간을 포함하는지 */
  isExpress: boolean;
  /** 탑승 시간(초). 경로 기록을 읽지 못하면 거리 기반 추정값 */
  durationSec: number;
  /** 이 이동이 지난 역 ID를 순서대로. 급행은 정차역만 있다. 경로 기록을 읽지 못하면 출발역과 도착역 */
  stationIds: string[];
}

export interface UserTimelineResponseDto {
  userId: string;
  totalDistanceKm: number;
  totalLogsCount: number;
  logs: UserTimelineLogItemDto[];
}

export interface UserMostVisitedStationDto {
  stationId: string;
  stationName: string;
  visitCount: number;
}

export interface UserStatsBucketDto {
  /** KST 기준 키: WEEK, MONTH는 'YYYY-MM-DD', YEAR는 'YYYY-MM', ALL은 'YYYY' */
  key: string;
  distanceKm: number;
  rideCount: number;
}

export interface UserLineBreakdownDto {
  lineId: string;
  distanceKm: number;
  rideDurationSec: number;
}

export interface UserTravelStatsResponseDto {
  userId: string;
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  totalDistanceKm: number;
  totalTravelCount: number;
  transferCount: number;
  totalRideDurationSec: number;
  mostVisitedStations: UserMostVisitedStationDto[];
  mostUsedLineId?: string;
  /** 기간 안의 모든 구간을 0으로 채운 막대 (WEEK 일 7개, MONTH 일 1~말일, YEAR 월 12개, ALL 연도별) */
  buckets: UserStatsBucketDto[];
  /** 호선별 이동 거리·탑승 시간, 거리 내림차순. 경로 기록을 읽지 못한 이동은 제외 */
  lineBreakdown: UserLineBreakdownDto[];
}

export interface UserLineMapStationDto {
  stationId: string;
  stationName: string;
  lineSeq: number;
  lat: number;
  lng: number;
  visited: boolean;
}

export interface UserLineMapLinkDto {
  fromStationId: string;
  toStationId: string;
}

export interface UserLineMapLineDto {
  lineId: string;
  lineName: string;
  colorHex: string;
  stations: UserLineMapStationDto[];
  links: UserLineMapLinkDto[];
}

export interface UserLineMapResponseDto {
  userId: string;
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  lines: UserLineMapLineDto[];
}
