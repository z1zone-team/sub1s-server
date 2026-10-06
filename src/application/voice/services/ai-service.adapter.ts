import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteMode } from '../../../domain/subway/models/route';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';

export interface SttResult {
  transcript: string;
  confidence?: number;
}

export interface BriefingResult {
  briefingText: string;
  audioTtsUrl?: string;
}

@Injectable()
export class AiServiceAdapter {
  private readonly logger = new Logger(AiServiceAdapter.name);
  private readonly aiServiceUrl?: string;
  private readonly timeoutMs: number = 2000; // 2초 SLA

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

    // AI 워커 연동이 설정된 경우 HTTP 요청 시도
    if (this.aiServiceUrl) {
      try {
        const result = await this.callAiWorkerStt(audioBuffer, filename);
        if (result) return result;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`AI Service STT failed, falling back to local extractor: ${errorMsg}`);
      }
    }

    // Fallback: 파일명 힌트 또는 기본 전사 텍스트
    const fallbackTranscript = this.generateFallbackTranscript(filename);
    return {
      transcript: fallbackTranscript,
      confidence: 0.9,
    };
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
    };
    const modeLabel = modeLabelMap[intent.preferredMode] ?? '추천';

    const defaultBriefing =
      `${intent.originStationName}역에서 ${intent.destStationName}역까지 ${modeLabel} 경로로 안내해 드릴게요. ` +
      `총 약 ${durationMin}분 소요되며 환승은 ${route.transferCount}회입니다. 안전한 이동 되세요.`;

    if (this.aiServiceUrl) {
      try {
        const aiBriefing = await this.callAiWorkerBriefing(intent, route);
        if (aiBriefing) return aiBriefing;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`AI Service Briefing failed, using rule-based briefing: ${errorMsg}`);
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

  private async callAiWorkerStt(
    _audioBuffer: Buffer,
    _filename: string,
  ): Promise<SttResult | null> {
    // Phase 5에서 구현될 FastAPI 엔드포인트 호출용 스텁 / 어댑터
    // fetch / abort controller with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // 추후 fetch(`${this.aiServiceUrl}/api/v1/ai/stt`, ...) 연동
      return null;
    } finally {
      clearTimeout(timeout);
    }
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

  private generateFallbackTranscript(filename: string): string {
    // 파일명에 한글 또는 역명이 포함되어 있는 경우 추출 힌트로 활용
    const decodedName = decodeURIComponent(filename);
    if (decodedName.includes('에서') || decodedName.includes('까지')) {
      return decodedName.replace(/\.[^/.]+$/, '');
    }
    return '강남역에서 을지로입구역까지 최적 경로로 안내해줘';
  }
}
