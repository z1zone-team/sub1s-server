import { Injectable } from '@nestjs/common';
import { GraphData } from '../../../domain/subway/models/subway-graph';
import { ISubwayGraphRepository } from '../../../domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubwayGraphRepository implements ISubwayGraphRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadGraphData(): Promise<GraphData> {
    const [stations, edges, transfers] = await Promise.all([
      this.prisma.station.findMany({
        select: {
          id: true,
          lineId: true,
          stationName: true,
          lat: true,
          lng: true,
          lineSeq: true,
        },
      }),
      this.prisma.routeEdge.findMany({
        select: {
          fromStationId: true,
          toStationId: true,
          lineId: true,
          direction: true,
          isExpress: true,
          distanceKm: true,
          durationSec: true,
          isEstimated: true,
        },
      }),
      this.prisma.transferEdge.findMany({
        select: {
          fromStationId: true,
          toStationId: true,
          walkingDurationSec: true,
        },
      }),
    ]);
    return { stations, edges, transfers };
  }
}
