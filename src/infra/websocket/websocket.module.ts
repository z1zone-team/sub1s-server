import { Module } from '@nestjs/common';
import { CongestionModule } from '../../application/congestion/congestion.module';
import { SubwayModule } from '../../domain/subway/subway.module';
import { SubwayEventsGateway } from './subway-events.gateway';

@Module({
  imports: [CongestionModule, SubwayModule],
  providers: [SubwayEventsGateway],
  exports: [SubwayEventsGateway],
})
export class WebsocketModule {}
