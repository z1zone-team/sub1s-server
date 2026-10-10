import { Injectable } from '@nestjs/common';
import {
  ISubwayLineRepository,
  SubwayLineRecord,
} from '../../../domain/place/ports/ISubwayLineRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubwayLineRepository implements ISubwayLineRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<SubwayLineRecord[]> {
    return this.prisma.subwayLine.findMany({
      select: { id: true, lineName: true, colorHex: true },
      orderBy: { id: 'asc' },
    });
  }
}
