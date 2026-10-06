export interface TrackingSessionDto {
  sessionId: string;
  currentStationId: string;
  currentStationName: string;
  nextStationId: string;
  nextStationName: string;
  destStationId: string;
  destStationName: string;
  remainingDurationSec: number;
  isOffRoute: boolean;
  expectedRemainingStationIds: string[];
}
