import { TravelLog } from '@prisma/client';
import { SubwayRouteOptionDto } from '../route/dto/route-search-response.dto';
import { ChoiceSnapshot } from '../../domain/subway/models/preference-model';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ScorePolicy } from '../../domain/ranking/models/score-policy';
import { isRouteMode, RouteMode } from '../../domain/subway/models/route';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  ITrackingRepository,
  TRACKING_REPOSITORY,
} from '../../domain/tracking/ports/ITrackingRepository';
import {
  DuplicateTravelLogError,
  ITravelLogRepository,
  TRAVEL_LOG_REPOSITORY,
  TravelLogWithStations,
} from '../../domain/travel/ports/ITravelLogRepository';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import {
  IPayloadEncryptor,
  PAYLOAD_ENCRYPTOR,
} from '../../domain/travel/ports/IPayloadEncryptor';
import { RankingNotifier } from './ranking.notifier';
import { RouteService } from '../route/route.service';
import {
  CreateTravelLogDto,
  LineMapQueryDto,
  LineMapResponseDto,
  LineMapLinkDto,
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
  ExpressRun,
  RideSegment,
  parsePayloadDurationSec,
  parseRideSegments,
  parseStationIds,
  parseExpressRuns,
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
    @Inject(PAYLOAD_ENCRYPTOR)
    private readonly cryptoService: IPayloadEncryptor,
    private readonly graphService: SubwayGraphService,
    @Inject(TRACKING_REPOSITORY)
    @Optional()
    private readonly trackingRepo?: ITrackingRepository,
    @Optional()
    private readonly rankingNotifier?: RankingNotifier,
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

    // 같은 주행의 완료가 다시 오면 점수를 또 주지 않고 처음 결과를 돌려준다
    if (dto.sessionId) {
      const prior = await this.travelLogRepo.findByTrackingSession(
        userId,
        dto.sessionId,
      );
      if (prior) return this.replayLog(userId, prior);
    }

    let chosen: SubwayRouteOptionDto | undefined;
    let choiceSnapshot: ChoiceSnapshot | undefined;
    const session =
      dto.sessionId && this.trackingRepo
        ? await this.trackingRepo.findById(dto.sessionId).catch(() => null)
        : null;
    if (session) {
      if (
        session &&
        session.userId === userId &&
        session.choiceSnapshot &&
        session.originStationId === dto.originStationId &&
        session.destStationId === dto.destStationId &&
        session.routeOption?.totalDistanceKm !== undefined &&
        session.routeOption?.transferCount !== undefined
      ) {
        chosen = session.routeOption as unknown as SubwayRouteOptionDto;
        choiceSnapshot = session.choiceSnapshot;
      }
    }
    const route =
      chosen ??
      (
        await this.routeService.search({
          originStationId: dto.originStationId,
          destinationStationId: dto.destStationId,
          routeMode: 'OPTIMAL',
        })
      ).options[0];
    const totalDistanceKm = route.totalDistanceKm;
    const transferCount = route.transferCount;

    // Check on-time completion bonus if sessionId is provided
    let isOnTime = false;
    let rideDurationSec: number | undefined;
    let arrivalDeltaSec: number | undefined;
    let routeMode: RouteMode | undefined;
    if (dto.sessionId && this.trackingRepo) {
      try {
        if (session && session.userId === userId) {
          const actualSec = (Date.now() - session.createdAt.getTime()) / 1000;
          const plannedSec = chosen?.totalDurationSec ?? route.totalDurationSec;
          rideDurationSec = Math.round(actualSec);
          // 사용자가 고른 경로 모드를 이력으로 남긴다 (추천 개인화에 쓴다)
          const chosenMode = session.routeOption?.mode;
          if (isRouteMode(chosenMode)) routeMode = chosenMode;
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

    // 점수는 본인의 유효한 주행 세션으로 완료한 기록에만 준다. 세션이 없으면 기록만 남긴다
    const verifiedSessionId =
      dto.sessionId && session && session.userId === userId
        ? dto.sessionId
        : undefined;
    const { distancePoints, onTimeBonus, earnedPoints } = verifiedSessionId
      ? ScorePolicy.calculateBreakdown(totalDistanceKm, isOnTime)
      : { distancePoints: 0, onTimeBonus: 0, earnedPoints: 0 };

    // 3-Tier Hybrid Encryption of detailed route trajectory
    const sensitivePayload = JSON.stringify({
      originStationId: dto.originStationId,
      destStationId: dto.destStationId,
      segments: route.segments,
      stationIds: route.stationIds,
      durationSec: chosen?.totalDurationSec,
      routeSource: chosen ? 'SELECTED' : 'RECALCULATED',
      completedAt: kstNowIso(),
    });
    const encrypted = this.cryptoService.encrypt(sensitivePayload);

    const monthlyKey = kstMonthKey(Date.now());

    // Upsert User to maintain foreign key integrity
    await this.userRepo.upsertPlaceholder(userId);

    // Atomic increment of Monthly and All-time rank scores + log creation
    let saved;
    try {
      saved = await this.travelLogRepo.saveTravelWithScores({
        userId,
        originStationId: dto.originStationId,
        destStationId: dto.destStationId,
        totalDistanceKm,
        transferCount,
        earnedPoints,
        routeMode,
        monthlyKey,
        trackingSessionId: verifiedSessionId,
        encrypted,
        choiceSnapshot,
      });
    } catch (error) {
      // 같은 세션의 완료 요청이 동시에 와서 다른 요청이 먼저 저장했다
      if (error instanceof DuplicateTravelLogError && dto.sessionId) {
        const prior = await this.travelLogRepo.findByTrackingSession(
          userId,
          dto.sessionId,
        );
        if (prior) return this.replayLog(userId, prior);
      }
      throw error;
    }
    const { monthlyScore, allScore, createdLog } = saved;
    // 완료한 주행의 세션은 더 쓸 일이 없으니 지운다
    if (verifiedSessionId) {
      await this.trackingRepo?.delete(verifiedSessionId).catch(() => false);
    }

    try {
      this.rankingNotifier?.sendScoreUpdate(userId, {
        periodKey: monthlyKey,
        currentPoints: monthlyScore.totalPoints,
      });
      this.rankingNotifier?.broadcastChanged({
        periodType: 'MONTHLY',
        periodKey: monthlyKey,
      });
      this.rankingNotifier?.broadcastChanged({
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

  /** 이동 통계와 노선도는 본인 것만 본다. 다른 사용자의 이동 이력을 볼 정책이 아직 없다 */
  private resolveTargetUser(currentUserId: string, requested?: string): string {
    if (requested && requested !== currentUserId) {
      throw new BusinessException(
        'FORBIDDEN_TRAVEL_HISTORY',
        '다른 사용자의 이동 기록은 볼 수 없어요.',
        HttpStatus.FORBIDDEN,
      );
    }
    return currentUserId;
  }

  private async replayLog(
    userId: string,
    log: TravelLog,
  ): Promise<TravelLogResponseDto> {
    const totals = await this.travelLogRepo.findScoreTotals(
      userId,
      kstMonthKey(Date.now()),
    );
    const { distancePoints } = ScorePolicy.calculateBreakdown(
      log.totalDistanceKm,
      false,
    );
    const distanceShare = Math.min(distancePoints, log.earnedPoints);
    return {
      logId: log.id,
      totalDistanceKm: log.totalDistanceKm,
      transferCount: log.transferCount,
      earnedPoints: log.earnedPoints,
      distancePoints: distanceShare,
      onTimeBonus: log.earnedPoints - distanceShare,
      currentTotalPoints: totals.allPoints,
      monthlyTotalPoints: totals.monthlyPoints,
    };
  }

  /**
   * 사용자가 최근에 고른 경로 모드와 시각(최신순). 추천 개인화가 자주 고르는 모드를 알아내는 데 쓴다.
   * 모드가 저장되지 않은 이전 기록은 포함하지 않는다
   */
  async getRecentRouteChoices(
    userId: string,
    limit = 20,
  ): Promise<Array<{ mode: RouteMode; createdAt: Date }>> {
    const rows = await this.travelLogRepo.findRecentRouteChoices(userId, limit);
    return rows.flatMap((row) =>
      isRouteMode(row.routeMode)
        ? [{ mode: row.routeMode, createdAt: row.createdAt }]
        : [],
    );
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
          stationIds: route.stationIds,
        };
      }),
    };
  }

  async getTravelStats(
    currentUserId: string,
    query: TravelStatsQueryDto,
  ): Promise<TravelStatsResponseDto> {
    const targetUserId = this.resolveTargetUser(currentUserId, query.userId);
    const nowMs = Date.now();
    const startDate = this.calculateStartDate(query.period, nowMs);

    const logs = await this.travelLogRepo.findStatsLogs(
      targetUserId,
      startDate,
    );

    const totalDistanceRaw = logs.reduce(
      (sum, l) => sum + l.totalDistanceKm,
      0,
    );
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
      const destLineId = l.destStation?.lineId ?? l.destStationId.split('_')[0];
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
    const targetUserId = this.resolveTargetUser(currentUserId, query.userId);
    const startDate = this.calculateStartDate(query.period);

    const logs = await this.travelLogRepo.findLineMapLogs(
      targetUserId,
      startDate,
    );

    const visitedSet = new Set<string>();
    const expressRuns: ExpressRun[] = [];
    const passedPairs: Array<[string, string]> = [];
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
          expressRuns.push(...parseExpressRuns(parsed));
          const passed = parseStationIds(parsed) ?? [];
          for (let i = 1; i < passed.length; i += 1) {
            passedPairs.push([passed[i - 1], passed[i]]);
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
        lat: s.lat,
        lng: s.lng,
        visited: visitedSet.has(s.id),
      });
    }

    // 급행이 지나친 역도 열차가 지나간 곳이라 방문으로 표시해야 노선도의 선이 끊기지 않는다
    for (const run of expressRuns) {
      const stations = linesMap.get(run.lineId) ?? [];
      const from = stations.find((s) => s.stationId === run.fromStationId);
      const to = stations.find((s) => s.stationId === run.toStationId);
      if (!from || !to) continue;
      const low = Math.min(from.lineSeq, to.lineSeq);
      const high = Math.max(from.lineSeq, to.lineSeq);
      for (const station of stations) {
        if (station.lineSeq >= low && station.lineSeq <= high) {
          station.visited = true;
        }
      }
    }

    // 지난 역 쌍 중 같은 호선의 두 역만 링크로 둔다(환승은 호선이 달라 빠진다). 같은 쌍은 방향과 상관없이 하나로 합친다
    const linksByLine = new Map<string, Map<string, LineMapLinkDto>>();
    for (const [from, to] of passedPairs) {
      const fromIndex = graph.indexOf(from);
      const toIndex = graph.indexOf(to);
      if (fromIndex === undefined || toIndex === undefined) continue;
      const lineId = graph.station(fromIndex).lineId;
      if (lineId !== graph.station(toIndex).lineId) continue;
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      const links =
        linksByLine.get(lineId) ?? new Map<string, LineMapLinkDto>();
      if (!links.has(key)) {
        links.set(key, { fromStationId: from, toStationId: to });
      }
      linksByLine.set(lineId, links);
    }

    const lines = Array.from(linesMap.entries()).map(([lineId, stations]) => {
      const meta = getLineMetadata(lineId);
      return {
        lineId,
        lineName: meta.lineName,
        colorHex: meta.colorHex,
        stations: stations.sort((a, b) => a.lineSeq - b.lineSeq),
        links: [...(linksByLine.get(lineId)?.values() ?? [])],
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

    const buckets = new Map<
      string,
      { distanceKm: number; rideCount: number }
    >();
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
    stationIds: string[];
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
      stationIds: parseStationIds(payload) ?? [
        log.originStationId,
        log.destStationId,
      ],
    };
  }

  private readRoutePayload(log: TravelLogWithStations): unknown {
    if (
      !log.encryptedRoutePayload ||
      !log.iv ||
      !log.authTag ||
      !log.wrappedDek
    ) {
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
