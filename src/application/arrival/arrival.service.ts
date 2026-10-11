import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { toKstIso } from '../../common/utils/kst';
import {
  INextTrainProvider,
  NEXT_TRAIN_PROVIDER,
  NextTrain,
} from '../../domain/arrival/ports/INextTrainProvider';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  DEFAULT_TRAINS_PER_DIRECTION,
  NextTrainDto,
  NextTrainsResponseDto,
} from './dto/next-trains.dto';

@Injectable()
export class ArrivalService {
  constructor(
    @Inject(NEXT_TRAIN_PROVIDER)
    private readonly provider: INextTrainProvider,
    private readonly graphService: SubwayGraphService,
  ) {}

  async getNextTrains(
    stationId: string,
    limit: number = DEFAULT_TRAINS_PER_DIRECTION,
  ): Promise<NextTrainsResponseDto> {
    const graph = this.graphService.getGraph();
    const index = graph.indexOf(stationId);
    if (index === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `station not found: ${stationId}`,
        HttpStatus.NOT_FOUND,
      );
    }
    const station = graph.station(index);

    const snapshot = await this.provider.fetchNextTrains({
      lineId: station.lineId,
      stationName: station.stationName,
    });

    // 캐시된 값은 가져온 뒤 시간이 지났으므로 흐른 만큼 빼서 지금 기준으로 맞춘다
    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() - snapshot.observedAt.getTime()) / 1000),
    );
    const adjusted = snapshot.trains
      .map((train) => this.adjust(train, elapsedSec))
      .sort(
        (a, b) =>
          (a.arrivalInSec ?? Number.MAX_SAFE_INTEGER) -
          (b.arrivalInSec ?? Number.MAX_SAFE_INTEGER),
      );

    const perDirection = new Map<string, number>();
    const trains = adjusted.filter((train) => {
      const count = perDirection.get(train.direction) ?? 0;
      perDirection.set(train.direction, count + 1);
      return count < limit;
    });

    return {
      stationId,
      stationName: station.stationName,
      lineId: station.lineId,
      source: snapshot.source,
      status: snapshot.status,
      updatedAt: toKstIso(snapshot.observedAt),
      trains,
    };
  }

  private adjust(train: NextTrain, elapsedSec: number): NextTrainDto {
    return {
      ...train,
      arrivalInSec:
        train.arrivalInSec === null
          ? null
          : Math.max(0, train.arrivalInSec - elapsedSec),
    };
  }
}
