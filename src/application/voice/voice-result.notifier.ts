import { VoiceJobError } from '../../domain/voice/models/voice-job';
import { VoiceResultDto } from './dto';

/**
 * 음성 작업이 끝났을 때 요청한 사용자에게 알리는 포트. 구현(WebSocket)은 infra에 있고
 * 이 계층은 어떤 방식으로 전달되는지 모른다
 */
export abstract class VoiceResultNotifier {
  abstract sendResult(
    userId: string,
    jobId: string,
    result: VoiceResultDto,
  ): void;

  abstract sendFailed(
    userId: string,
    jobId: string,
    error: VoiceJobError,
  ): void;
}
