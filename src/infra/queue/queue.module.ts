import { Module } from '@nestjs/common';
import { SttQueueClient } from './stt-queue.client';
import { ValkeyService } from './valkey.service';
import { VoicePipelineQueue } from './voice-pipeline.queue';

/** Valkey 연결과 음성 처리 큐(서버 워커용 `voice-route`, AI 워커용 `subway-voice`) */
@Module({
  providers: [ValkeyService, SttQueueClient, VoicePipelineQueue],
  exports: [ValkeyService, SttQueueClient, VoicePipelineQueue],
})
export class QueueModule {}
