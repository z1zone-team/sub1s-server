import { ChoiceSnapshot } from '../../subway/models/preference-model';
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
  /** 사용자가 안내를 시작할 때 고른 경로 모드. 주행 세션을 못 읽으면 없다 */
  routeMode?: string | null;
  choiceSnapshot?: ChoiceSnapshot;
  monthlyKey: string;
  encrypted: {
    ciphertext: string;
    iv: string;
    tag: string;
    wrappedDek: string;
  };
}

/** 이전 이동에서 고른 경로 모드와 시각. 추천 개인화의 선택 이력 */
export interface RouteChoiceRecord {
  choiceSnapshot?: ChoiceSnapshot;
  routeMode: string;
  createdAt: Date;
}

export interface SaveTravelLogResult {
  monthlyScore: RankScore;
  allScore: RankScore;
  createdLog: TravelLog;
}

export interface ITravelLogRepository {
  saveTravelWithScores(
    params: SaveTravelLogParams,
  ): Promise<SaveTravelLogResult>;
  findTimelineLogs(
    userId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<TravelLogWithStations[]>;
  findStatsLogs(
    userId: string,
    startDate?: Date,
  ): Promise<TravelLogWithStations[]>;
  findLineMapLogs(
    userId: string,
    startDate?: Date,
  ): Promise<TravelLogLineMapItem[]>;
  /** 모드가 저장된 최근 이동의 {모드, 시각}. 최신순이고 limit건까지 */
  findRecentRouteChoices(
    userId: string,
    limit: number,
  ): Promise<RouteChoiceRecord[]>;
  /** [start, end) 기간에 이동 기록이 있는 사용자별 횟수와 거리 */
  summarizeByUser(start: Date, end: Date): Promise<UserMonthlySummary[]>;
}

export const TRAVEL_LOG_REPOSITORY = Symbol('TRAVEL_LOG_REPOSITORY');
