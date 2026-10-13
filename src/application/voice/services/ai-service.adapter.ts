import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';
import { CURRENT_LOCATION, SAVED_PLACE_NAMES } from './intent-parser.service';

export interface SttResult {
  transcript: string;
  confidence?: number;
}

export interface TtsStream {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

export interface BriefingResult {
  briefingText: string;
  audioTtsUrl?: string;
}

/** 안내 문장에서 장소를 부르는 말. 현재 위치와 저장한 집, 학교는 역이 아니므로 `역`을 붙이지 않는다 */
function placeLabel(name: string): string {
  return name === CURRENT_LOCATION || SAVED_PLACE_NAMES.includes(name)
    ? name
    : `${name}역`;
}

@Injectable()
export class AiServiceAdapter {
  private readonly logger = new Logger(AiServiceAdapter.name);
  private readonly aiServiceUrl?: string;
  private readonly timeoutMs: number = 2000; // 브리핑 2초 SLA
  private readonly sttTimeoutMs: number = 15000; // CPU 환경 Whisper 전사 시간 고려
  private readonly ttsTimeoutMs: number = 15000; // 합성 시작부터 스트림이 끝날 때까지

  constructor(private readonly configService: ConfigService) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');
  }

  /**
   * 오디오 파일로부터 STT 음성 전사 결과를 획득합니다.
   * AI 워커 연결 실패 또는 타임아웃 시 안전한 Fallback 전사 텍스트를 반환합니다.
   */
  async transcribeAudio(
    audioBuffer: Buffer,
    filename: string,
    transcriptHint?: string,
  ): Promise<SttResult> {
    if (transcriptHint && transcriptHint.trim().length > 0) {
      return { transcript: transcriptHint.trim(), confidence: 1.0 };
    }

    if (!this.aiServiceUrl) {
      this.logger.warn(
        'AI_SERVICE_URL is not set, voice transcription is unavailable',
      );
      throw this.sttUnavailable();
    }
    try {
      const result = await this.callAiWorkerStt(audioBuffer, filename);
      if (result) return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI Service STT failed: ${errorMsg}`);
    }
    throw this.sttUnavailable();
  }

  private sttUnavailable(): BusinessException {
    return new BusinessException(
      'AI_SERVICE_UNAVAILABLE',
      '음성 인식을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * 추천 경로와 의도 분석 정보를 바탕으로 자연어 브리핑 및 TTS 음성 URL을 생성합니다.
   */
  async generateBriefing(
    intent: {
      originStationName: string;
      destStationName: string;
      preferredMode: RouteMode;
    },
    route: SubwayRouteOptionDto,
  ): Promise<BriefingResult> {
    const durationMin = Math.round(route.totalDurationSec / 60);
    const modeLabelMap: Record<RouteMode, string> = {
      OPTIMAL: '최적',
      COMFORTABLE: '여유 좌석',
      PERSONAL: '개인 맞춤',
      CHEAPEST: '최소 비용',
      ONLY_WALK: '도보 전용',
    };
    const modeLabel = modeLabelMap[intent.preferredMode] ?? '추천';

    const defaultBriefing =
      `${placeLabel(intent.originStationName)}에서 ${placeLabel(intent.destStationName)}까지 ${modeLabel} 경로로 안내해 드릴게요. ` +
      `총 약 ${durationMin}분 소요되며 환승은 ${route.transferCount}회입니다. 안전한 이동 되세요.`;

    if (this.aiServiceUrl) {
      try {
        const aiBriefing = await this.callAiWorkerBriefing(intent, route);
        if (aiBriefing) return aiBriefing;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `AI Service Briefing failed, using rule-based briefing: ${errorMsg}`,
        );
      }
    }

    // Edge-TTS 또는 오디오 안내 엔드포인트 URL
    const encodedText = encodeURIComponent(defaultBriefing);
    const fallbackTtsUrl = `/api/v1/voice/tts/stream?text=${encodedText}`;

    return {
      briefingText: defaultBriefing,
      audioTtsUrl: fallbackTtsUrl,
    };
  }

  /**
   * AI 서비스의 TTS 스트림을 열어 돌려줍니다. AI 서비스는 외부에 공개하지 않으므로 앱은 서버를 통해서만 받습니다.
   * AI 서비스가 없거나 응답하지 않으면 503입니다.
   */
  async openTtsStream(text: string): Promise<TtsStream> {
    if (!this.aiServiceUrl) {
      this.logger.warn('AI_SERVICE_URL is not set, TTS is unavailable');
      throw this.ttsUnavailable();
    }
    try {
      const res = await fetch(
        `${this.aiServiceUrl}/api/v1/ai/tts/stream?text=${encodeURIComponent(text)}`,
        { signal: AbortSignal.timeout(this.ttsTimeoutMs) },
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      return {
        body: await this.withFirstChunk(res.body),
        contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI Service TTS failed: ${errorMsg}`);
      throw this.ttsUnavailable();
    }
  }

  /**
   * AI 서비스는 음성 합성이 실패해도 먼저 200을 보내고 본문만 비우거나 끊는 경우가 있다.
   * 첫 조각을 미리 읽어 오디오가 실제로 오는지 확인해야 앱이 빈 소리를 받지 않고 503을 받는다
   */
  private async withFirstChunk(
    source: ReadableStream<Uint8Array>,
  ): Promise<ReadableStream<Uint8Array>> {
    const reader = source.getReader();
    const first = await reader.read();
    if (first.done || !first.value || first.value.length === 0) {
      await reader.cancel().catch(() => undefined);
      throw new Error('empty audio stream');
    }
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first.value);
      },
      async pull(controller) {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
  }

  private ttsUnavailable(): BusinessException {
    return new BusinessException(
      'AI_SERVICE_UNAVAILABLE',
      '음성 안내를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async callAiWorkerStt(
    audioBuffer: Buffer,
    filename: string,
  ): Promise<SttResult | null> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audioBuffer)]), filename);
    const res = await fetch(`${this.aiServiceUrl}/api/v1/ai/stt?language=ko`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.sttTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      transcript?: string;
      confidence?: number;
    };
    const transcript = body.transcript?.trim();
    if (!transcript) return null;
    return { transcript, confidence: body.confidence };
  }

  private async callAiWorkerBriefing(
    _intent: {
      originStationName: string;
      destStationName: string;
      preferredMode: RouteMode;
    },
    _route: SubwayRouteOptionDto,
  ): Promise<BriefingResult | null> {
    return null;
  }
}
