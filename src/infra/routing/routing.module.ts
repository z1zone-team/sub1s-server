import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { FareRule } from '../../domain/subway/fare/fare-calculator';
import { SubwayModule } from '../../domain/subway/subway.module';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { CAR_CONGESTION_PREDICTOR } from '../../domain/congestion/ports/ICarCongestionPredictor';
import {
  CONGESTION_PROVIDER,
  ICongestionProvider,
} from '../../domain/subway/ports/ICongestionProvider';
import {
  ISubwayRouteEngine,
  SUBWAY_ROUTE_ENGINE,
} from '../../domain/subway/ports/ISubwayRouteEngine';
import {
  CongestionData,
  StatisticalCongestionProvider,
} from '../congestion/statistical-congestion.provider';
import {
  FARE_RULE,
  SUBWAY_GRAPH_SOURCE,
  DijkstraRouteEngine,
} from './dijkstra-route.engine';
import { AStarRouteEngine } from './astar-route.engine';
import { getSubwayDataPath } from '../../common/utils/subway-data-path';

@Module({
  imports: [ConfigModule, SubwayModule],
  providers: [
    {
      provide: SUBWAY_GRAPH_SOURCE,
      useExisting: SubwayGraphService,
    },
    {
      provide: FARE_RULE,
      useFactory: (): FareRule => {
        const filePath = getSubwayDataPath('fare-rules.json');
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      },
    },
    {
      provide: CONGESTION_PROVIDER,
      useFactory: (): StatisticalCongestionProvider => {
        const filePath = getSubwayDataPath('congestion.json');
        const data: CongestionData = JSON.parse(readFileSync(filePath, 'utf-8'));
        return new StatisticalCongestionProvider(data);
      },
    },
    {
      // 칸별 혼잡도 예측도 같은 통계 모델이 맡는다. 서비스는 구체 클래스가 아니라 이 포트로 받는다
      provide: CAR_CONGESTION_PREDICTOR,
      useExisting: CONGESTION_PROVIDER,
    },
    DijkstraRouteEngine,
    AStarRouteEngine,
    {
      provide: SUBWAY_ROUTE_ENGINE,
      useFactory: (
        config: ConfigService,
        dijkstra: DijkstraRouteEngine,
        astar: AStarRouteEngine,
      ): ISubwayRouteEngine => {
        const engineType = config.get<string>('ROUTING_ENGINE', 'dijkstra');
        return engineType === 'astar' ? astar : dijkstra;
      },
      inject: [ConfigService, DijkstraRouteEngine, AStarRouteEngine],
    },
  ],
  exports: [
    SUBWAY_ROUTE_ENGINE,
    CONGESTION_PROVIDER,
    CAR_CONGESTION_PREDICTOR,
    DijkstraRouteEngine,
    AStarRouteEngine,
    SUBWAY_GRAPH_SOURCE,
    FARE_RULE,
  ],
})
export class RoutingModule {}
