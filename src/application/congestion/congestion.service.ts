import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { isWeakAirConditioned } from '../../common/utils/air-conditioning';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  CAR_CONGESTION_PREDICTOR,
  ICarCongestionPredictor,
} from '../../domain/congestion/ports/ICarCongestionPredictor';
import { TrainCongestionQueryDto } from './dto/train-congestion-query.dto';
import {
  CarCongestionDto,
  TrainCongestionResponseDto,
} from './dto/train-congestion-response.dto';
import { toKstIso } from '../../common/utils/kst';
import { trainCarCount } from '../../domain/congestion/services/train-composition';

@Injectable()
export class CongestionService {
  constructor(
    private readonly graphService: SubwayGraphService,
    @Inject(CAR_CONGESTION_PREDICTOR)
    private readonly congestionProvider: ICarCongestionPredictor,
  ) {}

  async getTrainCongestion(
    query: TrainCongestionQueryDto,
  ): Promise<TrainCongestionResponseDto> {
    const graph = this.graphService.getGraph();
    const stationIndex = graph.indexOf(query.stationId);
    if (stationIndex === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `unknown station id: ${query.stationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const station = graph.station(stationIndex);
    if (station.lineId !== query.lineId) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        `station ${query.stationId} does not belong to line ${query.lineId}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Determine direction: use query.direction if provided, otherwise pick from outgoing edges
    let direction = query.direction;
    if (!direction) {
      const edges = graph.edgesFrom(stationIndex);
      direction = edges.length > 0 ? edges[0].direction : 'DOWN';
    }

    const nowEpochMs = Date.now();
    const prediction = this.congestionProvider.predictCars(
      query.lineId,
      query.stationId,
      direction,
      nowEpochMs,
      [],
      trainCarCount(query.lineId, [query.stationId]) ?? null,
    );

    const cars: CarCongestionDto[] = prediction.cars.map((car) => ({
      carNo: car.carNo,
      rate: car.rate,
      level: car.level,
      isWeakAirConditioned: isWeakAirConditioned(query.lineId, car.carNo),
    }));

    const averageRate =
      cars.length > 0
        ? Math.round(cars.reduce((sum, c) => sum + c.rate, 0) / cars.length)
        : Math.round(prediction.ratePercent);

    return {
      lineId: query.lineId,
      trainId: query.trainId,
      stationId: query.stationId,
      averageRate,
      source: prediction.source,
      cars,
      updatedAt: toKstIso(nowEpochMs),
    };
  }
}
