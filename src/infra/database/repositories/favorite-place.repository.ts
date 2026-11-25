import { Injectable } from '@nestjs/common';
import {
  FavoritePlace,
  SaveFavoritePlace,
} from '../../../domain/user/models/favorite-place';
import { IFavoritePlaceRepository } from '../../../domain/user/ports/IFavoritePlaceRepository';
import { PrismaService } from '../../prisma/prisma.service';

const SELECT = {
  id: true,
  name: true,
  stationId: true,
  lat: true,
  lng: true,
  createdAt: true,
} as const;

@Injectable()
export class FavoritePlaceRepository implements IFavoritePlaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string): Promise<FavoritePlace[]> {
    return this.prisma.userFavoritePlace.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  count(userId: string): Promise<number> {
    return this.prisma.userFavoritePlace.count({ where: { userId } });
  }

  findByKey(userId: string, placeKey: string): Promise<FavoritePlace | null> {
    return this.prisma.userFavoritePlace.findUnique({
      where: { userId_placeKey: { userId, placeKey } },
      select: SELECT,
    });
  }

  create(userId: string, place: SaveFavoritePlace): Promise<FavoritePlace> {
    return this.prisma.userFavoritePlace.create({
      data: {
        userId,
        placeKey: place.placeKey,
        name: place.name,
        stationId: place.stationId,
        lat: place.lat,
        lng: place.lng,
      },
      select: SELECT,
    });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.userFavoritePlace.deleteMany({
      where: { userId, id },
    });
    return result.count > 0;
  }
}
