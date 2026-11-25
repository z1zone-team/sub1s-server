import { Prisma } from '@prisma/client';
import { ChoiceSnapshot } from '../../../domain/subway/models/preference-model';
import { UserMonthlySummary } from '../../../domain/notification/ports/notification-ports';
import { Injectable } from '@nestjs/common';
import {
  DuplicateTravelLogError,
  ITravelLogRepository,
  FrequentRouteRecord,
  RouteChoiceRecord,
  SaveTravelLogParams,
  SaveTravelLogResult,
  TravelLogLineMapItem,
  TravelLogWithStations,
} from '../../../domain/travel/ports/ITravelLogRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TravelLogRepository implements ITravelLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveTravelWithScores(
    params: SaveTravelLogParams,
  ): Promise<SaveTravelLogResult> {
    try {
      return await this.saveInTransaction(params);
    } catch (error) {
      if (
        params.trackingSessionId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DuplicateTravelLogError();
      }
      throw error;
    }
  }

  async findByTrackingSession(userId: string, trackingSessionId: string) {
    return this.prisma.travelLog.findFirst({
      where: { userId, trackingSessionId },
    });
  }

  async findScoreTotals(userId: string, monthlyKey: string) {
    const rows = await this.prisma.rankScore.findMany({
      where: {
        userId,
        OR: [
          { periodType: 'MONTHLY', periodKey: monthlyKey },
          { periodType: 'ALL', periodKey: 'ALL' },
        ],
      },
      select: { periodType: true, totalPoints: true },
    });
    const pointsOf = (type: string) =>
      rows.find((row) => row.periodType === type)?.totalPoints ?? 0;
    return { monthlyPoints: pointsOf('MONTHLY'), allPoints: pointsOf('ALL') };
  }

  private async saveInTransaction(
    params: SaveTravelLogParams,
  ): Promise<SaveTravelLogResult> {
    const [monthlyScore, allScore, createdLog] = await this.prisma.$transaction(
      [
        this.prisma.rankScore.upsert({
          where: {
            userId_periodType_periodKey: {
              userId: params.userId,
              periodType: 'MONTHLY',
              periodKey: params.monthlyKey,
            },
          },
          update: {
            totalPoints: { increment: params.earnedPoints },
            totalDistanceKm: { increment: params.totalDistanceKm },
          },
          create: {
            userId: params.userId,
            periodType: 'MONTHLY',
            periodKey: params.monthlyKey,
            totalPoints: params.earnedPoints,
            totalDistanceKm: params.totalDistanceKm,
          },
        }),
        this.prisma.rankScore.upsert({
          where: {
            userId_periodType_periodKey: {
              userId: params.userId,
              periodType: 'ALL',
              periodKey: 'ALL',
            },
          },
          update: {
            totalPoints: { increment: params.earnedPoints },
            totalDistanceKm: { increment: params.totalDistanceKm },
          },
          create: {
            userId: params.userId,
            periodType: 'ALL',
            periodKey: 'ALL',
            totalPoints: params.earnedPoints,
            totalDistanceKm: params.totalDistanceKm,
          },
        }),
        this.prisma.travelLog.create({
          data: {
            userId: params.userId,
            originStationId: params.originStationId,
            destStationId: params.destStationId,
            totalDistanceKm: params.totalDistanceKm,
            transferCount: params.transferCount,
            earnedPoints: params.earnedPoints,
            routeMode: params.routeMode ?? null,
            trackingSessionId: params.trackingSessionId ?? null,
            ...(params.choiceSnapshot
              ? {
                  choiceSnapshot:
                    params.choiceSnapshot as unknown as Prisma.InputJsonValue,
                }
              : {}),
            encryptedRoutePayload: params.encrypted.ciphertext,
            iv: params.encrypted.iv,
            authTag: params.encrypted.tag,
            wrappedDek: params.encrypted.wrappedDek,
          },
        }),
      ],
    );

    return { monthlyScore, allScore, createdLog };
  }

  async findTimelineLogs(
    userId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<TravelLogWithStations[]> {
    return this.prisma.travelLog.findMany({
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
  }

  async findStatsLogs(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TravelLogWithStations[]> {
    return this.prisma.travelLog.findMany({
      where: {
        userId,
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lt: endDate } : {}),
              },
            }
          : {}),
      },
      include: {
        originStation: true,
        destStation: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLineMapLogs(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TravelLogLineMapItem[]> {
    return this.prisma.travelLog.findMany({
      where: {
        userId,
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lt: endDate } : {}),
              },
            }
          : {}),
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
  }

  async findRecentRouteChoices(
    userId: string,
    limit: number,
  ): Promise<RouteChoiceRecord[]> {
    const rows = await this.prisma.travelLog.findMany({
      where: { userId, routeMode: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { routeMode: true, createdAt: true, choiceSnapshot: true },
    });
    return rows.flatMap((row) =>
      row.routeMode
        ? [
            {
              routeMode: row.routeMode,
              createdAt: row.createdAt,
              ...(row.choiceSnapshot
                ? {
                    choiceSnapshot:
                      row.choiceSnapshot as unknown as ChoiceSnapshot,
                  }
                : {}),
            },
          ]
        : [],
    );
  }

  async findFrequentRoutes(
    userId: string,
    since: Date,
    minTrips: number,
    limit: number,
  ): Promise<FrequentRouteRecord[]> {
    const groups = await this.prisma.travelLog.groupBy({
      by: ['originStationId', 'destStationId'],
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
      having: { originStationId: { _count: { gte: minTrips } } },
      orderBy: [
        { _count: { originStationId: 'desc' } },
        { _max: { createdAt: 'desc' } },
      ],
      take: limit,
    });
    if (groups.length === 0) return [];
    const ids = [
      ...new Set(groups.flatMap((g) => [g.originStationId, g.destStationId])),
    ];
    const stations = await this.prisma.station.findMany({
      where: { id: { in: ids } },
      select: { id: true, stationName: true },
    });
    const names = new Map(stations.map((s) => [s.id, s.stationName]));
    return groups.map((g) => ({
      originStationId: g.originStationId,
      originStationName: names.get(g.originStationId) ?? g.originStationId,
      destStationId: g.destStationId,
      destStationName: names.get(g.destStationId) ?? g.destStationId,
      tripCount: g._count._all,
      lastTraveledAt: g._max.createdAt ?? since,
    }));
  }

  async summarizeByUser(start: Date, end: Date): Promise<UserMonthlySummary[]> {
    const rows = await this.prisma.travelLog.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { totalDistanceKm: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      tripCount: row._count._all,
      distanceKm: row._sum.totalDistanceKm ?? 0,
    }));
  }
}
