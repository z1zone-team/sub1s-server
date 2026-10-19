import { Injectable } from '@nestjs/common';
import { ServiceDailyRow, TrainObservation } from '../../../domain/train-position/models/train-observation';
import { TrainPositionStatus } from '../../../domain/train-position/models/train-position';
import { ITrainObservationRepository } from '../../../domain/train-position/ports/ITrainObservationRepository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrainObservationRepository implements ITrainObservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveMany(observations: TrainObservation[]): Promise<void> {
    if (observations.length === 0) return;
    await this.prisma.trainObservation.createMany({ data: observations });
  }

  async findBetween(from: Date, to: Date): Promise<TrainObservation[]> {
    const rows = await this.prisma.trainObservation.findMany({
      where: { observedAt: { gte: from, lt: to } },
      orderBy: { observedAt: 'asc' },
    });
    return rows.map((row) => ({
      lineId: row.lineId,
      trainNo: row.trainNo,
      stationName: row.stationName,
      stationId: row.stationId,
      status: row.status as TrainPositionStatus,
      direction: row.direction,
      destinationName: row.destinationName,
      isLastTrain: row.isLastTrain,
      observedAt: row.observedAt,
    }));
  }

  async upsertDaily(rows: ServiceDailyRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.trainServiceDaily.upsert({
          where: {
            serviceDate_stationId_direction: {
              serviceDate: row.serviceDate,
              stationId: row.stationId,
              direction: row.direction,
            },
          },
          create: row,
          update: { firstSec: row.firstSec, lastSec: row.lastSec, samples: row.samples },
        }),
      ),
    );
  }

  async deleteObservationsBefore(before: Date): Promise<number> {
    const result = await this.prisma.trainObservation.deleteMany({ where: { observedAt: { lt: before } } });
    return result.count;
  }
}
