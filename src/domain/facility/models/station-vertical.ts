/**
 * 계단 축(stairs) 자료. 계단 개수 자료가 없어 경로가 오르내리는 높이로 근사한다.
 * 만드는 방법은 src/scripts/build-station-vertical.ts, 설계는 docs STAIRS_AXIS_DESIGN.md
 */
export interface StationVertical {
  /** 출입구에서 승강장까지 오르내리는 높이(m, 오른 높이 + 내린 높이). 출구를 모르므로 출구별 경로 값의 중앙값 */
  exitMeters: number;
  /** 같은 경로들의 오르내리는 층 수 중앙값(참고용) */
  exitLevels: number;
  /** SEOUL_METRO: 서울교통공사 승강기 높이(OA-12514)를 썼다, DEFAULT: 한 층 높이 기본값을 썼다 */
  heightSource: 'SEOUL_METRO' | 'DEFAULT';
}

export interface TransferVertical {
  /** 환승할 때 승강장에서 승강장까지 오르내리는 높이(m) */
  meters: number;
  levels: number;
  /** 글에 도착 노선이 나온 경로로 정했는지. false면 그 역 환승 경로 전체의 중앙값 */
  matchedLine: boolean;
}

export interface StationVerticalFile {
  version: 1;
  defaultLevelHeightM: number;
  stations: Record<string, StationVertical>;
  /** 키: `${fromStationId}>${toStationId}` (transfers.json의 환승 한 칸) */
  transfers: Record<string, TransferVertical>;
}

export const transferKey = (fromStationId: string, toStationId: string) =>
  `${fromStationId}>${toStationId}`;
