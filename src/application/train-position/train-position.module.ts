import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITrainPositionProvider,
  TRAIN_POSITION_PROVIDER,
} from '../../domain/train-position/ports/ITrainPositionProvider';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { SubwayModule } from '../../domain/subway/subway.module';
import { MockTrainPositionProvider } from '../../infra/train-position/mock-train-position.provider';
import { SeoulTrainPositionProvider } from '../../infra/train-position/seoul-train-position.provider';
import { TrainPositionController } from './train-position.controller';
import { TrainPositionService } from './train-position.service';
import { TrainServiceAggregator } from './train-service-aggregator';

@Module({
  imports: [SubwayModule],
  controllers: [TrainPositionController],
  providers: [
    TrainPositionService,
    TrainServiceAggregator,
    {
      provide: TRAIN_POSITION_PROVIDER,
      inject: [ConfigService, SubwayGraphService],
      // TRAIN_POSITION_SOURCE=MOCK이면 시연용 가짜 열차, 아니면 서울시 열차 위치 API
      useFactory: (
        config: ConfigService,
        graphService: SubwayGraphService,
      ): ITrainPositionProvider =>
        String(config.get('TRAIN_POSITION_SOURCE')).toUpperCase() === 'MOCK'
          ? new MockTrainPositionProvider(graphService)
          : new SeoulTrainPositionProvider(config),
    },
  ],
  exports: [TrainPositionService],
})
export class TrainPositionModule {}
