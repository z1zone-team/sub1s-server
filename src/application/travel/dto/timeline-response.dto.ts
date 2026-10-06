export interface TimelineLogItemDto {
  id: string;
  originStationName: string;
  destStationName: string;
  distanceKm: number;
  traveledAt: string; // ISO-8601
}

export interface TimelineResponseDto {
  totalDistanceKm: number;
  totalLogsCount: number;
  logs: TimelineLogItemDto[];
}
