export interface LineMapStationDto {
  stationId: string;
  stationName: string;
  lineSeq: number;
  lat: number;
  lng: number;
  visited: boolean;
}

export interface LineMapLineDto {
  lineId: string;
  lineName: string;
  colorHex: string;
  stations: LineMapStationDto[];
}

export interface LineMapResponseDto {
  userId: string;
  period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL';
  lines: LineMapLineDto[];
}
