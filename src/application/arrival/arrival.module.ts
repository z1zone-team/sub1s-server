import { Module } from '@nestjs/common';
import { NEXT_TRAIN_PROVIDER } from '../../domain/arrival/ports/INextTrainProvider';
import { SubwayModule } from '../../domain/subway/subway.module';
import { SeoulRealtimeArrivalProvider } from '../../infra/arrival/seoul-realtime-arrival.provider';
import { ArrivalController } from './arrival.controller';
import { ArrivalService } from './arrival.service';

@Module({
  imports: [SubwayModule],
  controllers: [ArrivalController],
  providers: [
    ArrivalService,
    { provide: NEXT_TRAIN_PROVIDER, useClass: SeoulRealtimeArrivalProvider },
  ],
})
export class ArrivalModule {}
