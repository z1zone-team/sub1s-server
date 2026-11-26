import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';
import {
  parseIntentHint,
  VoiceIntentHint,
} from '../../../infra/queue/stt-queue.client';
import { CURRENT_LOCATION, SAVED_PLACE_NAMES } from './intent-parser.service';

export interface SttResult {
  transcript: string;
  confidence?: number;
}

export interface BriefingResult {
  briefingText: string;
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
  // AI 서버 intent-hint 제한(3초)보다 조금 길게. 규칙으로 풀지 못한 문장에만 부른다
  private readonly intentHintTimeoutMs: number = 3500;

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
   * 추천 경로와 의도 분석 정보를 바탕으로 자연어 브리핑을 생성합니다.
   */
  async generateBriefing(
    intent: {
      originStationName: string;
      destStationName: string;
      preferredMode: RouteMode;
    },
    route: SubwayRouteOptionDto,
    /** 안내 문장에서 부를 이름. 주면 그대로 쓰고(역이면 `역`이 이미 붙어 있다), 없으면 이름으로 짐작한다 */
    labels?: { origin: string; destination: string },
  ): Promise<BriefingResult> {
    const durationMin = Math.round(route.totalDurationSec / 60);
    const modeLabelMap: Record<RouteMode, string> = {
      OPTIMAL: '최적',
      COMFORTABLE: '여유 좌석',
      PERSONAL: '개인 맞춤',
      CHEAPEST: '최소 비용',
      ONLY_WALK: '도보 전용',
      FASTEST: '최소시간',
      LEAST_WALK: '최소 도보',
      FEWEST_TRANSFERS: '최소 환승',
    };
    const modeLabel = modeLabelMap[intent.preferredMode] ?? '추천';

    const defaultBriefing =
      `${labels?.origin ?? placeLabel(intent.originStationName)}에서 ${labels?.destination ?? placeLabel(intent.destStationName)}까지 ${modeLabel} 경로로 안내해 드릴게요. ` +
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

    return { briefingText: defaultBriefing };
  }

  /**
   * 받아 적은 문장에서 Gemini 의도 힌트를 받는다(AI `POST /api/v1/ai/intent-hint`).
   * AI 서버가 없거나, Gemini가 쿼터로 쉬는 중이거나, 시간을 넘기면 null이다. 힌트가 없어도 음성 처리는 규칙 결과로 끝난다
   */
  async intentHint(transcript: string): Promise<VoiceIntentHint | null> {
    const textToSend = transcript.trim().slice(0, 500);
    if (!this.aiServiceUrl || !textToSend) return null;
    try {
      const res = await fetch(`${this.aiServiceUrl}/api/v1/ai/intent-hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSend }),
        signal: AbortSignal.timeout(this.intentHintTimeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        available?: boolean;
        hint?: unknown;
      };
      return body.available ? (parseIntentHint(body.hint) ?? null) : null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`intent-hint failed: ${message}`);
      return null;
    }
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
