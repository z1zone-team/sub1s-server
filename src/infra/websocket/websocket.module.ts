import { Module } from '@nestjs/common';
import { CongestionModule } from '../../application/congestion/congestion.module';
import { SubwayModule } from '../../domain/subway/subway.module';
import { AuthModule } from '../auth/auth.module';
import { SubwayEventsGateway } from './subway-events.gateway';
import { WebsocketRankingNotifier } from './websocket-ranking.notifier';
import { WebsocketVoiceResultNotifier } from './websocket-voice-result.notifier';

@Module({
  imports: [CongestionModule, SubwayModule, AuthModule],
  providers: [
    SubwayEventsGateway,
    WebsocketVoiceResultNotifier,
    WebsocketRankingNotifier,
  ],
  exports: [
    SubwayEventsGateway,
    WebsocketVoiceResultNotifier,
    WebsocketRankingNotifier,
  ],
})
export class WebsocketModule {}
