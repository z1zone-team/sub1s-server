export interface TravelLogResponseDto {
  logId: string;
  totalDistanceKm: number;
  transferCount: number;
  earnedPoints: number;
  currentTotalPoints: number; // 전체 누적 점수
  monthlyTotalPoints: number; // 이번 달 누적 점수
  rideDurationSec?: number; // 실제 탑승 시간. 주행 세션이 확인될 때만 포함
  arrivalDeltaSec?: number; // 실제 소요 - 예정 소요. 음수면 일찍 도착. 주행 세션이 확인될 때만 포함
}
