import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { RouteModule } from '../route/route.module';
import { AiServiceAdapter } from './services/ai-service.adapter';
import { IntentParserService } from './services/intent-parser.service';
import { VoiceLockService } from './services/voice-lock.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [RouteModule, SubwayModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    VoiceLockService,
    AiServiceAdapter,
    IntentParserService,
  ],
  exports: [VoiceService, VoiceLockService],
})
export class VoiceModule {}
