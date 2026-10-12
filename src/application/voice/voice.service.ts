import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { RouteService } from '../route/route.service';
import {
  VoiceRouteRecommendRequestDto,
  VoiceRouteRecommendResponseDto,
} from './dto';
import { AiServiceAdapter } from './services/ai-service.adapter';
import {
  CURRENT_LOCATION,
  IntentParserService,
} from './services/intent-parser.service';
import { VoiceLockService } from './services/voice-lock.service';

export interface UploadedAudioFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_MIME_TYPES = new Set([
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'video/webm', // 일부 브라우저 녹음 바이너리 MIME
  'application/octet-stream', // curl 또는 일부 클라이언트 기본 헤더 허용
]);

const ALLOWED_EXTENSIONS = new Set(['.m4a', '.wav', '.mp3', '.webm']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly voiceLockService: VoiceLockService,
    private readonly aiServiceAdapter: AiServiceAdapter,
    private readonly intentParserService: IntentParserService,
    private readonly subwayGraphService: SubwayGraphService,
    private readonly routeService: RouteService,
  ) {}

  /**
   * 음성 질의 파일을 수신받아 5초 멱등성 락 검증 후
   * STT -> 의도 분석 -> 경로 탐색 -> AI 브리핑/TTS 합성을 오케스트레이션합니다.
   */
  async recommendRouteByVoice(
    userId: string,
    file?: UploadedAudioFile,
    dto?: VoiceRouteRecommendRequestDto,
  ): Promise<VoiceRouteRecommendResponseDto> {
    // 1. 5초 멱등성 락 검증 (연타/중복 요청 방어)
    await this.voiceLockService.assertLock(userId, 5);

    // 2. 파일 유효성 검사
    this.validateAudioFile(file);

    // 3. STT 음성 전사 (FastAPI AI 서비스 또는 Fallback)
    const sttResult = await this.aiServiceAdapter.transcribeAudio(
      file!.buffer,
      file!.originalname,
      dto?.transcriptHint,
    );

    // 4. 의도 분석 및 슬롯 필링
    const intent = this.intentParserService.parseIntent(
      sttResult.transcript,
      dto?.preferredMode,
    );

    // 5. 역명 매핑 및 검증
    const originIsCurrentLocation =
      intent.originStationName === CURRENT_LOCATION;
    if (
      originIsCurrentLocation &&
      (dto?.lat === undefined || dto?.lng === undefined)
    ) {
      throw new BusinessException(
        'VOICE_ORIGIN_REQUIRED',
        '출발지를 말씀해 주시거나 현재 위치를 켜 주세요.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const originStationId = originIsCurrentLocation
      ? null
      : this.findStationIdByName(intent.originStationName);
    const destStationId = this.findStationIdByName(intent.destStationName);

    if (!originIsCurrentLocation && !originStationId) {
      throw new NotFoundException(
        `출발역 '${intent.originStationName}'을(를) 지하철 노선망에서 찾을 수 없습니다.`,
      );
    }
    if (!destStationId) {
      throw new NotFoundException(
        `도착역 '${intent.destStationName}'을(를) 지하철 노선망에서 찾을 수 없습니다.`,
      );
    }
    if (!originIsCurrentLocation && originStationId === destStationId) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        '출발역과 도착역이 동일합니다. 다른 역을 지정해주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 6. 다익스트라 경로 탐색
    // 로그인 사용자의 설문, 시간대, 이력으로 개인화한 추천(PERSONAL)을 받도록 사용자를 넘긴다
    const searchResult = await this.routeService.search(
      {
        ...(originIsCurrentLocation
          ? { originLat: dto!.lat, originLng: dto!.lng }
          : { originStationId: originStationId! }),
        destinationStationId: destStationId,
        routeMode: intent.preferredMode,
      },
      userId,
    );

    const recommendedRoute =
      searchResult.options.find((opt) => opt.mode === intent.preferredMode) ??
      searchResult.options[0];

    if (!recommendedRoute) {
      throw new NotFoundException(
        '요청한 조건에 맞는 경로를 탐색할 수 없습니다.',
      );
    }

    // 7. AI 자연어 브리핑 및 TTS 음성 URL 생성
    const briefing = await this.aiServiceAdapter.generateBriefing(
      intent,
      recommendedRoute,
    );

    return {
      transcript: sttResult.transcript,
      interpretedIntent: intent,
      recommendedRoute,
      briefingText: briefing.briefingText,
      audioTtsUrl: briefing.audioTtsUrl,
    };
  }

  private validateAudioFile(file?: UploadedAudioFile): void {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('오디오 파일(file)이 필요합니다.');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        '오디오 파일 크기는 최대 5MB를 초과할 수 없습니다.',
      );
    }

    const lowerName = file.originalname.toLowerCase();
    const hasValidExt = Array.from(ALLOWED_EXTENSIONS).some((ext) =>
      lowerName.endsWith(ext),
    );

    const hasValidMime = ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase());

    if (!hasValidExt && !hasValidMime) {
      throw new BadRequestException(
        '지원하지 않는 오디오 파일 형식입니다. (m4a, wav, mp3, webm만 가능)',
      );
    }
  }

  /**
   * 역 이름으로 지하철 그래프 내 Station ID를 조회합니다.
   */
  findStationIdByName(name: string): string | null {
    const normalizedTarget =
      this.intentParserService.normalizeStationName(name);
    const graph = this.subwayGraphService.getGraph();

    for (let i = 0; i < graph.stationCount; i++) {
      const station = graph.station(i);
      const normalizedStation = this.intentParserService.normalizeStationName(
        station.stationName,
      );
      if (normalizedStation === normalizedTarget) {
        return station.id;
      }
    }

    return null;
  }
}
