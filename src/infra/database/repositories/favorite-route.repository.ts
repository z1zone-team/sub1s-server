import { Injectable } from '@nestjs/common';
import {
  FavoriteRoute,
  SaveFavoriteRoute,
} from '../../../domain/user/models/favorite-route';
import { IFavoriteRouteRepository } from '../../../domain/user/ports/IFavoriteRouteRepository';
import { PrismaService } from '../../prisma/prisma.service';

const SELECT = {
  id: true,
  originName: true,
  originStationId: true,
  originLat: true,
  originLng: true,
  destinationName: true,
  destinationStationId: true,
  destinationLat: true,
  destinationLng: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  originName: string;
  originStationId: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationName: string;
  destinationStationId: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  createdAt: Date;
};

const toFavorite = (row: Row): FavoriteRoute => ({
  id: row.id,
  origin: {
    name: row.originName,
    stationId: row.originStationId,
    lat: row.originLat,
    lng: row.originLng,
  },
  destination: {
    name: row.destinationName,
    stationId: row.destinationStationId,
    lat: row.destinationLat,
    lng: row.destinationLng,
  },
  createdAt: row.createdAt,
});

@Injectable()
export class FavoriteRouteRepository implements IFavoriteRouteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<FavoriteRoute[]> {
    const rows = await this.prisma.userFavoriteRoute.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toFavorite);
  }

  count(userId: string): Promise<number> {
    return this.prisma.userFavoriteRoute.count({ where: { userId } });
  }

  async findByKey(
    userId: string,
    routeKey: string,
  ): Promise<FavoriteRoute | null> {
    const row = await this.prisma.userFavoriteRoute.findUnique({
      where: { userId_routeKey: { userId, routeKey } },
      select: SELECT,
    });
    return row ? toFavorite(row) : null;
  }

  async create(
    userId: string,
    favorite: SaveFavoriteRoute,
  ): Promise<FavoriteRoute> {
    const row = await this.prisma.userFavoriteRoute.create({
      data: {
        userId,
        routeKey: favorite.routeKey,
        originName: favorite.origin.name,
        originStationId: favorite.origin.stationId,
        originLat: favorite.origin.lat,
        originLng: favorite.origin.lng,
        destinationName: favorite.destination.name,
        destinationStationId: favorite.destination.stationId,
        destinationLat: favorite.destination.lat,
        destinationLng: favorite.destination.lng,
      },
      select: SELECT,
    });
    return toFavorite(row);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.userFavoriteRoute.deleteMany({
      where: { userId, id },
    });
    return result.count > 0;
  }
}
