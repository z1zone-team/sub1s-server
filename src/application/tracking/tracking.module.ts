import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { InMemoryTrackingRepository } from '../../infra/database/repositories/in-memory-tracking.repository';
import { WebsocketModule } from '../../infra/websocket/websocket.module';
import { RouteModule } from '../route/route.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [SubwayModule, RouteModule, WebsocketModule],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    OffRouteDetector,
    {
      provide: TRACKING_REPOSITORY,
      useClass: InMemoryTrackingRepository,
    },
  ],
  exports: [TrackingService, OffRouteDetector],
})
export class TrackingModule {}
