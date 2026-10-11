import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ScorePolicy } from '../../domain/ranking/models/score-policy';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  ITrackingRepository,
  TRACKING_REPOSITORY,
} from '../../domain/tracking/ports/ITrackingRepository';
import {
  ITravelLogRepository,
  TRAVEL_LOG_REPOSITORY,
  TravelLogWithStations,
} from '../../domain/travel/ports/ITravelLogRepository';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import { CryptoService } from '../../infra/security/crypto.service';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
import { RouteService } from '../route/route.service';
import {
  CreateTravelLogDto,
  LineMapQueryDto,
  LineMapResponseDto,
  LineMapStationDto,
  StatsBucketDto,
  TimelineQueryDto,
  TimelineResponseDto,
  TravelLogResponseDto,
  TravelStatsQueryDto,
  TravelStatsResponseDto,
} from './dto';
import { getLineMetadata } from './constants/subway-lines.constant';
import {
  RideSegment,
  parsePayloadDurationSec,
  parseRideSegments,
} from './route-payload';
import {
  kstAddDays,
  kstDayKey,
  kstDaysInMonth,
  kstMidnight,
  kstMonthKey,
  kstNowIso,
  kstStartOfMonth,
  kstStartOfYear,
  kstYearKey,
  toKstDate,
  toKstIso,
} from '../../common/utils/kst';

@Injectable()
export class TravelLogService {
  private readonly logger = new Logger(TravelLogService.name);

  constructor(
    @Inject(TRAVEL_LOG_REPOSITORY)
    private readonly travelLogRepo: ITravelLogRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly routeService: RouteService,
    private readonly cryptoService: CryptoService,
    private readonly graphService: SubwayGraphService,
    @Inject(TRACKING_REPOSITORY)
    @Optional()
    private readonly trackingRepo?: ITrackingRepository,
    @Optional()
    private readonly gateway?: SubwayEventsGateway,
  ) {}

  async createLog(
    userId: string,
    dto: CreateTravelLogDto,
  ): Promise<TravelLogResponseDto> {
    const graph = this.graphService.getGraph();
    const originIdx = graph.indexOf(dto.originStationId);
    if (originIdx === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `origin station not found: ${dto.originStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const destIdx = graph.indexOf(dto.destStationId);
    if (destIdx === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `destination station not found: ${dto.destStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Official route calculation via backend engine
    const searchRes = await this.routeService.search({
      originStationId: dto.originStationId,
      destinationStationId: dto.destStationId,
      routeMode: 'OPTIMAL',
    });

    const route = searchRes.options[0];
    const totalDistanceKm = route.totalDistanceKm;
    const transferCount = route.transferCount;

    // Check on-time completion bonus if sessionId is provided
    let isOnTime = false;
    let rideDurationSec: number | undefined;
    let arrivalDeltaSec: number | undefined;
    if (dto.sessionId && this.trackingRepo) {
      try {
        const session = await this.trackingRepo.findById(dto.sessionId);
        if (session && session.userId === userId) {
          const actualSec = (Date.now() - session.createdAt.getTime()) / 1000;
          const plannedSec = route.totalDurationSec;
          rideDurationSec = Math.round(actualSec);
          arrivalDeltaSec = Math.round(actualSec - plannedSec);
          // Within +-5 minutes (+-300 seconds)
          if (Math.abs(actualSec - plannedSec) <= 300) {
            isOnTime = true;
          }
        }
      } catch (err) {
        this.logger.warn(`Could not verify session ${dto.sessionId}: ${err}`);
      }
    }

    const { distancePoints, onTimeBonus, earnedPoints } =
      ScorePolicy.calculateBreakdown(totalDistanceKm, isOnTime);

    // 3-Tier Hybrid Encryption of detailed route trajectory
    const sensitivePayload = JSON.stringify({
      originStationId: dto.originStationId,
      destStationId: dto.destStationId,
      segments: route.segments,
      stationIds: route.stationIds,
      completedAt: kstNowIso(),
    });
    const encrypted = this.cryptoService.encrypt(sensitivePayload);

    const monthlyKey = kstMonthKey(Date.now());

    // Upsert User to maintain foreign key integrity
    await this.userRepo.upsertPlaceholder(userId);

    // Atomic increment of Monthly and All-time rank scores + log creation
    const { monthlyScore, allScore, createdLog } =
      await this.travelLogRepo.saveTravelWithScores({
        userId,
        originStationId: dto.originStationId,
        destStationId: dto.destStationId,
        totalDistanceKm,
        transferCount,
        earnedPoints,
        monthlyKey,
        encrypted,
      });

    try {
      this.gateway?.sendRankingUpdate(userId, {
        periodKey: monthlyKey,
        currentPoints: monthlyScore.totalPoints,
      });
      this.gateway?.broadcastRankingChanged({
        periodType: 'MONTHLY',
        periodKey: monthlyKey,
      });
      this.gateway?.broadcastRankingChanged({
        periodType: 'ALL',
        periodKey: 'ALL',
      });
    } catch (err) {
      this.logger.warn(`Failed to broadcast ranking update: ${err}`);
    }

    return {
      logId: createdLog.id,
      totalDistanceKm,
      transferCount,
      earnedPoints,
      distancePoints,
      onTimeBonus,
      currentTotalPoints: allScore.totalPoints,
      monthlyTotalPoints: monthlyScore.totalPoints,
      rideDurationSec,
      arrivalDeltaSec,
    };
  }

  async getTimeline(
    userId: string,
    query: TimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    const startOfMonth = kstStartOfMonth(query.year, query.month);
    const endOfMonth = kstStartOfMonth(query.year, query.month + 1);

    const logs = await this.travelLogRepo.findTimelineLogs(
      userId,
      startOfMonth,
      endOfMonth,
    );

    const totalDistanceKm = logs.reduce((sum, l) => sum + l.totalDistanceKm, 0);

    return {
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      totalLogsCount: logs.length,
      logs: logs.map((l) => {
        const route = this.describeRoute(l);
        return {
          id: l.id,
          originStationName: l.originStation
            ? l.originStation.stationName
            : l.originStationId,
          destStationName: l.destStation
            ? l.destStation.stationName
            : l.destStationId,
          distanceKm: l.totalDistanceKm,
          traveledAt: toKstIso(l.createdAt),
          lineIds: route.lineIds,
          isExpress: route.isExpress,
          durationSec: route.durationSec,
        };
      }),
    };
  }

  async getTravelStats(
    currentUserId: string,
    query: TravelStatsQueryDto,
  ): Promise<TravelStatsResponseDto> {
    const targetUserId = query.userId ?? currentUserId;
    const nowMs = Date.now();
    const startDate = this.calculateStartDate(query.period, nowMs);

    const logs = await this.travelLogRepo.findStatsLogs(targetUserId, startDate);

    const totalDistanceRaw = logs.reduce((sum, l) => sum + l.totalDistanceKm, 0);
    const totalDistanceKm = Math.round(totalDistanceRaw * 10) / 10;
    const totalTravelCount = logs.length;
    const transferCount = logs.reduce((sum, l) => sum + l.transferCount, 0);

    let totalRideDurationSec = 0;
    const stationMap = new Map<
      string,
      { stationId: string; stationName: string; visitCount: number }
    >();
    const lineCountMap = new Map<string, number>();
    const lineTotals = new Map<
      string,
      { distanceKm: number; rideDurationSec: number }
    >();

    for (const l of logs) {
      // 1. 탑승 시간과 호선별 거리·시간 (저장된 경로 구간 기준)
      const route = this.describeRoute(l);
      totalRideDurationSec += route.durationSec;
      for (const segment of route.segments ?? []) {
        const total = lineTotals.get(segment.lineId) ?? {
          distanceKm: 0,
          rideDurationSec: 0,
        };
        total.distanceKm += segment.distanceKm;
        total.rideDurationSec += segment.durationSec;
        lineTotals.set(segment.lineId, total);
      }

      // 2. 방문 역 카운트
      const originName = l.originStation
        ? l.originStation.stationName
        : l.originStationId;
      const destName = l.destStation
        ? l.destStation.stationName
        : l.destStationId;

      const o = stationMap.get(l.originStationId) ?? {
        stationId: l.originStationId,
        stationName: originName,
        visitCount: 0,
      };
      o.visitCount += 1;
      stationMap.set(l.originStationId, o);

      const d = stationMap.get(l.destStationId) ?? {
        stationId: l.destStationId,
        stationName: destName,
        visitCount: 0,
      };
      d.visitCount += 1;
      stationMap.set(l.destStationId, d);

      // 3. 최다 이용 호선 카운트
      const originLineId =
        l.originStation?.lineId ?? l.originStationId.split('_')[0];
      const destLineId =
        l.destStation?.lineId ?? l.destStationId.split('_')[0];
      if (originLineId) {
        lineCountMap.set(
          originLineId,
          (lineCountMap.get(originLineId) ?? 0) + 1,
        );
      }
      if (destLineId) {
        lineCountMap.set(destLineId, (lineCountMap.get(destLineId) ?? 0) + 1);
      }
    }

    const mostVisitedStations = Array.from(stationMap.values())
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 3);

    let mostUsedLineId: string | undefined = undefined;
    let maxLineCount = 0;
    for (const [lineId, count] of lineCountMap.entries()) {
      if (count > maxLineCount) {
        maxLineCount = count;
        mostUsedLineId = lineId;
      }
    }

    const lineBreakdown = Array.from(lineTotals.entries())
      .map(([lineId, total]) => ({
        lineId,
        distanceKm: Math.round(total.distanceKm * 10) / 10,
        rideDurationSec: Math.round(total.rideDurationSec),
      }))
      .sort((a, b) => b.distanceKm - a.distanceKm);

    return {
      userId: targetUserId,
      period: query.period,
      totalDistanceKm,
      totalTravelCount,
      transferCount,
      totalRideDurationSec,
      mostVisitedStations,
      mostUsedLineId,
      buckets: this.buildBuckets(query.period, logs, nowMs),
      lineBreakdown,
    };
  }

  async getLineMap(
    currentUserId: string,
    query: LineMapQueryDto,
  ): Promise<LineMapResponseDto> {
    const targetUserId = query.userId ?? currentUserId;
    const startDate = this.calculateStartDate(query.period);

    const logs = await this.travelLogRepo.findLineMapLogs(targetUserId, startDate);

    const visitedSet = new Set<string>();
    for (const l of logs) {
      visitedSet.add(l.originStationId);
      visitedSet.add(l.destStationId);

      if (l.encryptedRoutePayload && l.iv && l.authTag && l.wrappedDek) {
        try {
          const decrypted = this.cryptoService.decrypt({
            ciphertext: l.encryptedRoutePayload,
            iv: l.iv,
            tag: l.authTag,
            wrappedDek: l.wrappedDek,
          });
          const parsed = JSON.parse(decrypted);
          if (Array.isArray(parsed.stationIds)) {
            for (const sId of parsed.stationIds) {
              visitedSet.add(sId);
            }
          }
        } catch {
          // skip
        }
      }
    }

    const graph = this.graphService.getGraph();
    const linesMap = new Map<string, LineMapStationDto[]>();

    for (let i = 0; i < graph.stationCount; i++) {
      const s = graph.station(i);
      let lineStations = linesMap.get(s.lineId);
      if (!lineStations) {
        lineStations = [];
        linesMap.set(s.lineId, lineStations);
      }
      lineStations.push({
        stationId: s.id,
        stationName: s.stationName,
        lineSeq: s.lineSeq ?? lineStations.length + 1,
        visited: visitedSet.has(s.id),
      });
    }

    const lines = Array.from(linesMap.entries()).map(([lineId, stations]) => {
      const meta = getLineMetadata(lineId);
      return {
        lineId,
        lineName: meta.lineName,
        colorHex: meta.colorHex,
        stations: stations.sort((a, b) => a.lineSeq - b.lineSeq),
      };
    });

    return {
      userId: targetUserId,
      period: query.period,
      lines,
    };
  }

  // 기간 경계는 서버 시간대가 아닌 KST 기준이고, WEEK는 오늘을 포함한 최근 7일이다
  private calculateStartDate(
    period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL',
    nowMs: number = Date.now(),
  ): Date | undefined {
    const today = toKstDate(nowMs);
    if (period === 'WEEK') {
      return kstAddDays(nowMs, -6);
    }
    if (period === 'MONTH') {
      return kstStartOfMonth(today.year, today.month);
    }
    if (period === 'YEAR') {
      return kstStartOfYear(today.year);
    }
    return undefined;
  }

  private buildBuckets(
    period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL',
    logs: TravelLogWithStations[],
    nowMs: number,
  ): StatsBucketDto[] {
    const keyOf =
      period === 'YEAR'
        ? kstMonthKey
        : period === 'ALL'
          ? kstYearKey
          : kstDayKey;

    const buckets = new Map<string, { distanceKm: number; rideCount: number }>();
    for (const key of this.bucketKeys(period, logs, nowMs)) {
      buckets.set(key, { distanceKm: 0, rideCount: 0 });
    }
    for (const l of logs) {
      const bucket = buckets.get(keyOf(l.createdAt));
      if (bucket) {
        bucket.distanceKm += l.totalDistanceKm;
        bucket.rideCount += 1;
      }
    }

    return Array.from(buckets.entries()).map(([key, bucket]) => ({
      key,
      distanceKm: Math.round(bucket.distanceKm * 10) / 10,
      rideCount: bucket.rideCount,
    }));
  }

  private bucketKeys(
    period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL',
    logs: TravelLogWithStations[],
    nowMs: number,
  ): string[] {
    const today = toKstDate(nowMs);
    if (period === 'WEEK') {
      return Array.from({ length: 7 }, (_, i) =>
        kstDayKey(kstAddDays(nowMs, i - 6)),
      );
    }
    if (period === 'MONTH') {
      const days = kstDaysInMonth(today.year, today.month);
      return Array.from({ length: days }, (_, i) =>
        kstDayKey(kstMidnight(today.year, today.month, i + 1)),
      );
    }
    if (period === 'YEAR') {
      return Array.from({ length: 12 }, (_, i) =>
        kstMonthKey(kstMidnight(today.year, i + 1, 1)),
      );
    }
    if (logs.length === 0) return [];
    const firstYear = Math.min(...logs.map((l) => toKstDate(l.createdAt).year));
    const count = Math.max(today.year - firstYear + 1, 1);
    return Array.from({ length: count }, (_, i) => String(firstYear + i));
  }

  // 저장된 경로를 읽지 못하면 출발역 호선과 거리 기반 추정으로 대체한다
  private describeRoute(log: TravelLogWithStations): {
    segments?: RideSegment[];
    lineIds: string[];
    isExpress: boolean;
    durationSec: number;
  } {
    const payload = this.readRoutePayload(log);
    const segments = parseRideSegments(payload);

    const originLineId =
      log.originStation?.lineId ?? log.originStationId.split('_')[0];
    const lineIds =
      segments && segments.length > 0
        ? Array.from(new Set(segments.map((s) => s.lineId)))
        : originLineId
          ? [originLineId]
          : [];

    let durationSec = parsePayloadDurationSec(payload) ?? 0;
    if (durationSec === 0 && segments && segments.length > 0) {
      durationSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    }
    if (durationSec === 0) {
      durationSec = Math.round(log.totalDistanceKm * 110);
    }

    return {
      segments,
      lineIds,
      isExpress: segments?.some((s) => s.isExpress) ?? false,
      durationSec: Math.round(durationSec),
    };
  }

  private readRoutePayload(log: TravelLogWithStations): unknown {
    if (!log.encryptedRoutePayload || !log.iv || !log.authTag || !log.wrappedDek) {
      return undefined;
    }
    try {
      const decrypted = this.cryptoService.decrypt({
        ciphertext: log.encryptedRoutePayload,
        iv: log.iv,
        tag: log.authTag,
        wrappedDek: log.wrappedDek,
      });
      return JSON.parse(decrypted) as unknown;
    } catch {
      return undefined;
    }
  }
}
