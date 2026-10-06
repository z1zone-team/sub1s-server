export interface MostVisitedStationDto {
  stationId: string;
  stationName: string;
  visitCount: number;
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
}
