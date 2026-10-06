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
  TimelineQueryDto,
  TimelineResponseDto,
  TravelLogResponseDto,
} from './dto';

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
}
