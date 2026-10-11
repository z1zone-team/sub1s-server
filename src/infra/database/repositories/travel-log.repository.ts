import { UserMonthlySummary } from '../../../domain/notification/ports/notification-ports';
import { Injectable } from '@nestjs/common';
import {
  ITravelLogRepository,
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
    const [monthlyScore, allScore, createdLog] = await this.prisma.$transaction([
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
          encryptedRoutePayload: params.encrypted.ciphertext,
          iv: params.encrypted.iv,
          authTag: params.encrypted.tag,
          wrappedDek: params.encrypted.wrappedDek,
        },
      }),
    ]);

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
  ): Promise<TravelLogWithStations[]> {
    return this.prisma.travelLog.findMany({
      where: {
        userId,
        ...(startDate ? { createdAt: { gte: startDate } } : {}),
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
  ): Promise<TravelLogLineMapItem[]> {
    return this.prisma.travelLog.findMany({
      where: {
        userId,
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
