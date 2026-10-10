import { Module } from '@nestjs/common';
import { CongestionModule } from '../../application/congestion/congestion.module';
import { SubwayModule } from '../../domain/subway/subway.module';
import { AuthModule } from '../auth/auth.module';
import { SubwayEventsGateway } from './subway-events.gateway';

@Module({
  imports: [CongestionModule, SubwayModule, AuthModule],
  providers: [SubwayEventsGateway],
  exports: [SubwayEventsGateway],
})
export class WebsocketModule {}
