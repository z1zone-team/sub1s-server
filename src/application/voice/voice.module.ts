import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { WebsocketVoiceResultNotifier } from '../../infra/websocket/websocket-voice-result.notifier';
import { WebsocketModule } from '../../infra/websocket/websocket.module';
import { RouteModule } from '../route/route.module';
import { AiServiceAdapter } from './services/ai-service.adapter';
import { IntentParserService } from './services/intent-parser.service';
import { VoiceController } from './voice.controller';
import { VoiceJobService } from './voice-job.service';
import { VoicePipelineProcessor } from './voice-pipeline.processor';
import { VoiceResultNotifier } from './voice-result.notifier';
import { VoiceService } from './voice.service';

@Module({
  imports: [RouteModule, SubwayModule, QueueModule, WebsocketModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    AiServiceAdapter,
    IntentParserService,
    VoiceJobService,
    VoicePipelineProcessor,
    { provide: VoiceResultNotifier, useExisting: WebsocketVoiceResultNotifier },
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
