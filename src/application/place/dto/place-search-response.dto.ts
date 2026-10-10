export interface StationLineDto {
  lineId: string;
  lineName: string;
  colorHex: string;
}

export interface StationSearchItemDto {
  type: 'STATION';
  /** 호선별 역 노드 ID. 환승역은 호선마다 한 건씩 나오며, 이 ID로 경로를 탐색한다. */
  stationId: string;
  /** '역' 접미사 없는 역명이 기본이다 (예: '강남'). 소스 데이터명이 다른 역은 표시명으로 보정한다. */
  name: string;
  lat: number;
  lng: number;
  /** 이 항목의 호선 ("서울역 1호선"의 1호선). */
  line: StationLineDto;
  /** 같은 역을 지나는 전체 호선 (최근 도착지 등 호선 배지 묶음 표시용). `line`을 포함한다. */
  lines: StationLineDto[];
}

export interface NearestStationDto {
  stationId: string;
  name: string;
  walkDistanceM: number;
  walkDurationSec: number;
}

export interface PlaceSearchItemDto {
  type: 'PLACE';
  name: string;
  address: string;
  category?: string;
  lat: number;
  lng: number;
  nearestStation: NearestStationDto;
}

export type PlaceSearchResultItemDto =
  StationSearchItemDto | PlaceSearchItemDto;

export interface StationLookupResultDto {
  /** 요청한 순서대로. `stationId`는 요청한 ID 그대로이며 없는 ID는 제외된다. */
  items: StationSearchItemDto[];
}

export interface PlaceSearchResultDto {
  items: PlaceSearchResultItemDto[];
}
