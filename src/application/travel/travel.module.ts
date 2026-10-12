import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { AuthModule } from '../../infra/auth/auth.module';
import { SecurityModule } from '../../infra/security/security.module';
import { WebsocketRankingNotifier } from '../../infra/websocket/websocket-ranking.notifier';
import { WebsocketModule } from '../../infra/websocket/websocket.module';
import { RouteModule } from '../route/route.module';
import { TrackingModule } from '../tracking/tracking.module';
import { LineMapController } from './line-map.controller';
import { TravelLogController } from './travel-log.controller';
import { RankingNotifier } from './ranking.notifier';
import { TravelLogService } from './travel-log.service';

@Module({
  imports: [
    SubwayModule,
    RouteModule,
    SecurityModule,
    AuthModule,
    TrackingModule,
    WebsocketModule,
  ],
  controllers: [TravelLogController, LineMapController],
  providers: [
    TravelLogService,
    { provide: RankingNotifier, useExisting: WebsocketRankingNotifier },
  ],
  exports: [TravelLogService],
})
export class TravelModule {}
