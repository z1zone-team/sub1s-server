export interface LineMapStationDto {
  stationId: string;
  stationName: string;
  lineSeq: number;
  lat: number;
  lng: number;
  visited: boolean;
}

/** 이동하면서 이어서 지난 같은 호선의 두 역. 지선이 있는 호선도 실제 지난 순서대로 잇는 데 쓴다 */
export interface LineMapLinkDto {
  fromStationId: string;
  toStationId: string;
}

export interface LineMapLineDto {
  lineId: string;
  lineName: string;
  colorHex: string;
  stations: LineMapStationDto[];
  /** 이 호선에서 이어서 지난 역 쌍. 중복은 하나로 합친다. 경로 기록을 읽지 못한 이동은 없다 */
  links: LineMapLinkDto[];
}

export interface LineMapResponseDto {
  userId: string;
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  lines: LineMapLineDto[];
}
