export interface TimelineLogItemDto {
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

export interface TimelineResponseDto {
  totalDistanceKm: number;
  totalLogsCount: number;
  logs: TimelineLogItemDto[];
}
