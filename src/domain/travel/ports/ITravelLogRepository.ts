import { RankScore, Station, TravelLog } from '@prisma/client';
import { UserMonthlySummary } from '../../notification/ports/notification-ports';

export type TravelLogWithStations = TravelLog & {
  originStation: Station | null;
  destStation: Station | null;
};

export interface TravelLogLineMapItem {
  originStationId: string;
  destStationId: string;
  encryptedRoutePayload: string | null;
  iv: string | null;
  authTag: string | null;
  wrappedDek: string | null;
}

export interface SaveTravelLogParams {
  userId: string;
  originStationId: string;
  destStationId: string;
  totalDistanceKm: number;
  transferCount: number;
  earnedPoints: number;
  monthlyKey: string;
  encrypted: {
    ciphertext: string;
    iv: string;
    tag: string;
    wrappedDek: string;
  };
}

export interface SaveTravelLogResult {
  monthlyScore: RankScore;
  allScore: RankScore;
  createdLog: TravelLog;
}

export interface ITravelLogRepository {
  saveTravelWithScores(params: SaveTravelLogParams): Promise<SaveTravelLogResult>;
  findTimelineLogs(userId: string, startOfMonth: Date, endOfMonth: Date): Promise<TravelLogWithStations[]>;
  findStatsLogs(userId: string, startDate?: Date): Promise<TravelLogWithStations[]>;
  findLineMapLogs(userId: string, startDate?: Date): Promise<TravelLogLineMapItem[]>;
  /** [start, end) 기간에 이동 기록이 있는 사용자별 횟수와 거리 */
  summarizeByUser(start: Date, end: Date): Promise<UserMonthlySummary[]>;
}

export const TRAVEL_LOG_REPOSITORY = Symbol('TRAVEL_LOG_REPOSITORY');
