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
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/security/crypto.service';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
import { RouteService } from '../route/route.service';
import {
  CreateTravelLogDto,
  LineMapQueryDto,
  LineMapResponseDto,
  LineMapStationDto,
  TimelineQueryDto,
  TimelineResponseDto,
  TravelLogResponseDto,
  TravelStatsQueryDto,
  TravelStatsResponseDto,
} from './dto';
import { getLineMetadata } from './constants/subway-lines.constant';

@Injectable()
export class TravelLogService {
  private readonly logger = new Logger(TravelLogService.name);

  constructor(
    private readonly prisma: PrismaService,
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
    if (dto.sessionId && this.trackingRepo) {
      try {
        const session = await this.trackingRepo.findById(dto.sessionId);
        if (session) {
          const actualSec = (Date.now() - session.createdAt.getTime()) / 1000;
          const plannedSec = route.totalDurationSec;
          // Within +-5 minutes (+-300 seconds)
          if (Math.abs(actualSec - plannedSec) <= 300) {
            isOnTime = true;
          }
        }
      } catch (err) {
        this.logger.warn(`Could not verify session ${dto.sessionId}: ${err}`);
      }
    }

    const earnedPoints = ScorePolicy.calculateEarnedPoints(
      totalDistanceKm,
      isOnTime,
    );

    // 3-Tier Hybrid Encryption of detailed route trajectory
    const sensitivePayload = JSON.stringify({
      originStationId: dto.originStationId,
      destStationId: dto.destStationId,
      segments: route.segments,
      completedAt: new Date().toISOString(),
    });
    const encrypted = this.cryptoService.encrypt(sensitivePayload);

    const now = new Date();
    const monthlyKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Upsert User to maintain foreign key integrity
    await this.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        clerkId: `clerk_${userId}`,
        nickname: '테스트유저',
      },
    });

    // Atomic increment of Monthly and All-time rank scores + log creation
    const [monthlyScore, allScore, createdLog] = await this.prisma.$transaction(
      [
        this.prisma.rankScore.upsert({
          where: {
            userId_periodType_periodKey: {
              userId,
              periodType: 'MONTHLY',
              periodKey: monthlyKey,
            },
          },
          update: {
            totalPoints: { increment: earnedPoints },
            totalDistanceKm: { increment: totalDistanceKm },
          },
          create: {
            userId,
            periodType: 'MONTHLY',
            periodKey: monthlyKey,
            totalPoints: earnedPoints,
            totalDistanceKm,
          },
        }),
        this.prisma.rankScore.upsert({
          where: {
            userId_periodType_periodKey: {
              userId,
              periodType: 'ALL',
              periodKey: 'ALL',
            },
          },
          update: {
            totalPoints: { increment: earnedPoints },
            totalDistanceKm: { increment: totalDistanceKm },
          },
          create: {
            userId,
            periodType: 'ALL',
            periodKey: 'ALL',
            totalPoints: earnedPoints,
            totalDistanceKm,
          },
        }),
        this.prisma.travelLog.create({
          data: {
            userId,
            originStationId: dto.originStationId,
            destStationId: dto.destStationId,
            totalDistanceKm,
            transferCount,
            earnedPoints,
            encryptedRoutePayload: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.tag,
            wrappedDek: encrypted.wrappedDek,
          },
        }),
      ],
    );

    // Broadcast ranking update via WebSocket gateway
    try {
      this.gateway?.broadcastRankingUpdate({
        userId,
        periodKey: monthlyKey,
        currentPoints: monthlyScore.totalPoints,
      });
    } catch (err) {
      this.logger.warn(`Failed to broadcast ranking update: ${err}`);
    }

    return {
      logId: createdLog.id,
      totalDistanceKm,
      transferCount,
      earnedPoints,
      currentTotalPoints: allScore.totalPoints,
    };
  }

  async getTimeline(
    userId: string,
    query: TimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    const startOfMonth = new Date(query.year, query.month - 1, 1);
    const endOfMonth = new Date(query.year, query.month, 1);

    const logs = await this.prisma.travelLog.findMany({
      where: {
        userId,
        createdAt: {
          gte: startOfMonth,
          lt: endOfMonth,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        originStation: true,
        destStation: true,
      },
    });

    const totalDistanceKm = logs.reduce((sum, l) => sum + l.totalDistanceKm, 0);

    return {
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      totalLogsCount: logs.length,
      logs: logs.map((l) => ({
        id: l.id,
        originStationName: l.originStation
          ? l.originStation.stationName
          : l.originStationId,
        destStationName: l.destStation
          ? l.destStation.stationName
          : l.destStationId,
        distanceKm: l.totalDistanceKm,
        traveledAt: l.createdAt.toISOString(),
      })),
    };
  }

  async getTravelStats(
    currentUserId: string,
    query: TravelStatsQueryDto,
  ): Promise<TravelStatsResponseDto> {
    const targetUserId = query.userId ?? currentUserId;
    const startDate = this.calculateStartDate(query.period);

    const logs = await this.prisma.travelLog.findMany({
      where: {
        userId: targetUserId,
        ...(startDate ? { createdAt: { gte: startDate } } : {}),
      },
      include: {
        originStation: true,
        destStation: true,
      },
      orderBy: { createdAt: 'desc' },
    });

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

    for (const l of logs) {
      // 1. 소요시간 계산 (복호화 또는 거리 비례 1km당 110초)
      let durationSec = 0;
      if (l.encryptedRoutePayload && l.iv && l.authTag && l.wrappedDek) {
        try {
          const decrypted = this.cryptoService.decrypt({
            ciphertext: l.encryptedRoutePayload,
            iv: l.iv,
            tag: l.authTag,
            wrappedDek: l.wrappedDek,
          });
          const parsed = JSON.parse(decrypted);
          if (typeof parsed.durationSec === 'number') {
            durationSec = parsed.durationSec;
          }
        } catch {
          // fallback
        }
      }
      if (durationSec === 0) {
        durationSec = Math.round(l.totalDistanceKm * 110);
      }
      totalRideDurationSec += durationSec;

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

    return {
      userId: targetUserId,
      period: query.period,
      totalDistanceKm,
      totalTravelCount,
      transferCount,
      totalRideDurationSec,
      mostVisitedStations,
      mostUsedLineId,
    };
  }

  async getLineMap(
    currentUserId: string,
    query: LineMapQueryDto,
  ): Promise<LineMapResponseDto> {
    const targetUserId = query.userId ?? currentUserId;
    const startDate = this.calculateStartDate(query.period);

    const logs = await this.prisma.travelLog.findMany({
      where: {
        userId: targetUserId,
        ...(startDate ? { createdAt: { gte: startDate } } : {}),
      },
      select: {
        originStationId: true,
        destStationId: true,
        encryptedRoutePayload: true,
        iv: true,
        authTag: true,
        wrappedDek: true,
      },
    });

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

  private calculateStartDate(period: 'WEEK' | 'MONTH' | 'YEAR' | 'ALL'): Date | undefined {
    const now = new Date();
    if (period === 'WEEK') {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    if (period === 'MONTH') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (period === 'YEAR') {
      return new Date(now.getFullYear(), 0, 1);
    }
    return undefined;
  }
}
