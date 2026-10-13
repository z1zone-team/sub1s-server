import { Module } from '@nestjs/common';
import { CongestionModule } from '../../application/congestion/congestion.module';
import { SubwayModule } from '../../domain/subway/subway.module';
import { AuthModule } from '../auth/auth.module';
import { SubwayEventsGateway } from './subway-events.gateway';
import { WebsocketOffRouteNotifier } from './websocket-off-route.notifier';
import { WebsocketRankingNotifier } from './websocket-ranking.notifier';
import { WebsocketVoiceResultNotifier } from './websocket-voice-result.notifier';

@Module({
  imports: [CongestionModule, SubwayModule, AuthModule],
  providers: [
    SubwayEventsGateway,
    WebsocketVoiceResultNotifier,
    WebsocketRankingNotifier,
    WebsocketOffRouteNotifier,
  ],
  exports: [
    SubwayEventsGateway,
    WebsocketVoiceResultNotifier,
    WebsocketRankingNotifier,
    WebsocketOffRouteNotifier,
  ],
})
export class WebsocketModule {}
