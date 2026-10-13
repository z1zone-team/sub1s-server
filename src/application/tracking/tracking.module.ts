import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { AuthModule } from '../../infra/auth/auth.module';
import { InMemoryTrackingRepository } from '../../infra/tracking/in-memory-tracking.repository';
import { WebsocketModule } from '../../infra/websocket/websocket.module';
import { WebsocketOffRouteNotifier } from '../../infra/websocket/websocket-off-route.notifier';
import { RouteModule } from '../route/route.module';
import { OffRouteNotifier } from './off-route.notifier';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [SubwayModule, RouteModule, WebsocketModule, AuthModule],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    OffRouteDetector,
    { provide: OffRouteNotifier, useExisting: WebsocketOffRouteNotifier },
    {
      provide: TRACKING_REPOSITORY,
      useClass: InMemoryTrackingRepository,
    },
  ],
  exports: [TrackingService, OffRouteDetector],
})
export class TrackingModule {}
