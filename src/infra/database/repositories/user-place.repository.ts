import { Injectable } from '@nestjs/common';
import { PlaceKind, SaveUserPlace, UserPlace } from '../../../domain/user/models/place';
import { IUserPlaceRepository } from '../../../domain/user/ports/IUserPlaceRepository';
import { PrismaService } from '../../prisma/prisma.service';

const SELECT = { kind: true, name: true, stationId: true, lat: true, lng: true } as const;

@Injectable()
export class UserPlaceRepository implements IUserPlaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<UserPlace[]> {
    return this.prisma.userPlace.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { kind: 'asc' },
    });
  }

  async save(userId: string, kind: PlaceKind, place: SaveUserPlace): Promise<UserPlace> {
    return this.prisma.userPlace.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, ...place },
      update: place,
      select: SELECT,
    });
  }

  async remove(userId: string, kind: PlaceKind): Promise<boolean> {
    const result = await this.prisma.userPlace.deleteMany({ where: { userId, kind } });
    return result.count > 0;
  }
}
