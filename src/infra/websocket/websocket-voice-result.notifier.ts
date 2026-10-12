import { Injectable } from '@nestjs/common';
import { VoiceJobError } from '../../domain/voice/models/voice-job';
import { VoiceRouteRecommendResponseDto } from '../../application/voice/dto';
import { VoiceResultNotifier } from '../../application/voice/voice-result.notifier';
import { SubwayEventsGateway } from './subway-events.gateway';

/** 음성 작업 결과를 WebSocket으로 요청한 사용자(`user:{id}` 방)에게 보낸다 */
@Injectable()
export class WebsocketVoiceResultNotifier extends VoiceResultNotifier {
  constructor(private readonly gateway: SubwayEventsGateway) {
    super();
  }

  sendResult(
    userId: string,
    jobId: string,
    result: VoiceRouteRecommendResponseDto,
  ): void {
    this.gateway.sendVoiceResult(userId, { jobId, result });
  }

  sendFailed(userId: string, jobId: string, error: VoiceJobError): void {
    this.gateway.sendVoiceFailed(userId, { jobId, error });
  }
}
