import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { isRouteMode, RouteMode } from '../../domain/subway/models/route';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { VoiceIntentHint } from '../../infra/queue/stt-queue.client';
import { UserPlace } from '../../domain/user/models/place';
import {
  IUserPlaceRepository,
  USER_PLACE_REPOSITORY,
} from '../../domain/user/ports/IUserPlaceRepository';
import { PlaceSearchResultItemDto } from '../place/dto/place-search-response.dto';
import { PlaceService } from '../place/place.service';
import { RouteSearchRequestDto } from '../route/dto/route-search-request.dto';
import { RouteService } from '../route/route.service';
import {
  InterpretedIntentDto,
  VoiceDestinationCandidateDto,
  VoiceOriginDto,
  VoiceResultDto,
  VoiceRouteRecommendRequestDto,
} from './dto';
import { AiServiceAdapter } from './services/ai-service.adapter';
import {
  CURRENT_LOCATION,
  HOME_PLACE,
  IntentParserService,
  SAVED_PLACE_NAMES,
} from './services/intent-parser.service';

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

/** 출발지나 도착지를 경로 검색 요청으로 바꾼 것. 역이면 `stationId`도 가진다 */
interface ResolvedEndpoint {
  stationId?: string;
  search: Partial<RouteSearchRequestDto>;
  /** 안내 문장에서 부르는 말. 역이면 `역`을 붙이고 장소와 현재 위치는 붙이지 않는다 */
  label: string;
}

/** 출발지나 도착지를 해석한 결과. 하나로 정해지면 `endpoint`, 사용자에게 물어야 하면 `candidates` */
type ResolvedPlace =
  { endpoint: ResolvedEndpoint } | { candidates: PlaceSearchResultItemDto[] };

type EndpointSide = 'origin' | 'destination';

/** 장소 검색에서 가져오는 후보 수와, 확인 화면에 보여 주는 최대 후보 수 */
const PLACE_SEARCH_LIMIT = 10;
const MAX_CANDIDATES = 5;

const comparable = (text: string): string =>
  text.replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();

/** 받아 적은 문장을 풀지 못한 오류인지(이름을 다시 해석하면 풀릴 수 있는 것만) */
function isNotUnderstood(error: unknown): boolean {
  if (error instanceof BusinessException) {
    return error.errorCode === 'VOICE_INTENT_NOT_UNDERSTOOD';
  }
  // 말한 이름이 역도 장소도 아닐 때(resolveEndpoint)
  return (
    error instanceof NotFoundException &&
    error.message.includes('지하철 노선망에서 찾을 수 없습니다')
  );
}

const validMode = (mode: string | undefined): RouteMode | undefined =>
  isRouteMode(mode) ? mode : undefined;

/** Gemini 힌트로 규칙이 알아듣는 문장을 만든다. 도착지가 없으면 만들지 않는다 */
function hintToSentence(hint: VoiceIntentHint): string | null {
  const destination = hint.destination?.trim();
  if (!destination) return null;
  const origin = hint.origin?.trim();
  return origin
    ? `${origin}에서 ${destination}까지 가는 길`
    : `${destination} 가는 길`;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly aiServiceAdapter: AiServiceAdapter,
    private readonly intentParserService: IntentParserService,
    private readonly subwayGraphService: SubwayGraphService,
    private readonly routeService: RouteService,
    @Inject(USER_PLACE_REPOSITORY)
    private readonly placeRepo: IUserPlaceRepository,
    private readonly placeService: PlaceService,
  ) {}

  /**
   * 전사문에서 의도 분석, 경로 탐색, 브리핑까지 처리합니다. 큐 작업(서버 워커)이 STT 이후에 부릅니다.
   */
  async recommendFromTranscript(
    userId: string,
    transcript: string,
    dto?: Pick<VoiceRouteRecommendRequestDto, 'preferredMode' | 'lat' | 'lng'>,
    sttHint?: VoiceIntentHint,
  ): Promise<VoiceResultDto> {
    // 4. 의도 분석: 규칙(역 사전, 장소, 집과 학교)이 먼저 정한다
    let firstError: unknown;
    try {
      const intent = this.applyModeHint(
        this.intentParserService.parseIntent(transcript, dto?.preferredMode),
        sttHint,
        dto?.preferredMode,
      );
      return await this.recommendForIntent(userId, transcript, intent, dto);
    } catch (error: unknown) {
      if (!isNotUnderstood(error)) throw error;
      firstError = error;
    }

    // 규칙이 풀지 못한 문장은 Gemini 힌트로 문장을 다시 만들어 같은 규칙으로 한 번 더 푼다.
    // 음성 인식이 힌트를 함께 줬으면 그것을, 아니면(Whisper, 앱 기기 인식) AI 서버에 묻는다
    const hint = sttHint?.destination
      ? sttHint
      : await this.aiServiceAdapter.intentHint(transcript);
    const rewritten = hint && hintToSentence(hint);
    if (!rewritten) throw firstError;
    let retried: InterpretedIntentDto;
    try {
      retried = this.intentParserService.parseIntent(
        rewritten,
        dto?.preferredMode ?? validMode(hint.mode),
      );
    } catch {
      throw firstError;
    }
    this.logger.log(
      `Voice intent rescued by Gemini hint: "${transcript}" -> "${rewritten}"`,
    );
    const intent: InterpretedIntentDto = {
      ...retried,
      reason: dto?.preferredMode
        ? retried.reason
        : '받아 적은 문장을 AI(Gemini)로 다시 해석했습니다.',
    };
    try {
      return await this.recommendForIntent(userId, transcript, intent, dto);
    } catch (error: unknown) {
      // 다시 풀어도 찾지 못하면 처음 오류(사용자가 말한 이름 기준)를 알린다
      if (isNotUnderstood(error)) throw firstError;
      throw error;
    }
  }

  /** 규칙이 경로 조건을 못 찾아 기본(OPTIMAL)이고 Gemini가 조건을 들었으면 그 조건을 쓴다. 사용자가 고른 모드가 있으면 그대로 */
  private applyModeHint(
    intent: InterpretedIntentDto,
    hint: VoiceIntentHint | undefined,
    overrideMode: RouteMode | undefined,
  ): InterpretedIntentDto {
    const mode = validMode(hint?.mode);
    if (
      overrideMode ||
      intent.preferredMode !== 'OPTIMAL' ||
      !mode ||
      mode === 'OPTIMAL'
    ) {
      return intent;
    }
    return {
      ...intent,
      preferredMode: mode,
      reason: '말한 경로 조건을 AI(Gemini)가 알아들었습니다.',
    };
  }

  private async recommendForIntent(
    userId: string,
    transcript: string,
    intent: InterpretedIntentDto,
    dto?: Pick<VoiceRouteRecommendRequestDto, 'preferredMode' | 'lat' | 'lng'>,
  ): Promise<VoiceResultDto> {
    // 5. 역 이름, 현재 위치, 저장한 집과 학교, 장소 이름과 주소를 경로 검색 입력으로 바꾼다
    const resolvedOrigin = await this.resolveEndpoint(
      userId,
      intent.originStationName,
      'origin',
      dto,
    );
    const resolvedDestination = await this.resolveEndpoint(
      userId,
      intent.destStationName,
      'destination',
    );
    // 출발지로 말한 이름의 후보가 여럿이면 경로를 계산하지 않고 "이 곳이 맞나요?"를 묻는다(출발부터 묻는다)
    if ('candidates' in resolvedOrigin) {
      return {
        kind: 'CONFIRM_ORIGIN',
        transcript,
        interpretedIntent: intent,
        originCandidates: this.toCandidates(resolvedOrigin.candidates),
        ...('endpoint' in resolvedDestination
          ? {
              destination: this.toEndpointDto(
                resolvedDestination.endpoint,
                intent.destStationName,
                'destination',
              ),
            }
          : {
              destinationCandidates: this.toCandidates(
                resolvedDestination.candidates,
              ),
            }),
      };
    }
    const origin = resolvedOrigin.endpoint;
    // 도착지로 말한 이름의 후보가 여럿이면 경로를 계산하지 않고 "이 곳이 맞나요?"를 묻는다
    if ('candidates' in resolvedDestination) {
      return {
        kind: 'CONFIRM_DESTINATION',
        transcript,
        interpretedIntent: intent,
        origin: this.toEndpointDto(origin, intent.originStationName, 'origin'),
        candidates: this.toCandidates(resolvedDestination.candidates),
      };
    }
    const dest = resolvedDestination.endpoint;
    if (origin.stationId && origin.stationId === dest.stationId) {
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
        ...origin.search,
        ...dest.search,
        routeMode: intent.preferredMode,
      } as RouteSearchRequestDto,
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

    // 7. AI 자연어 브리핑 생성
    const briefing = await this.aiServiceAdapter.generateBriefing(
      intent,
      recommendedRoute,
      { origin: origin.label, destination: dest.label },
    );

    return {
      kind: 'ROUTE',
      transcript,
      interpretedIntent: intent,
      recommendedRoute,
      briefingText: briefing.briefingText,
    };
  }

  /** 오디오 파일의 존재, 크기(5MB), 형식을 검사합니다. 검증에 실패하면 400입니다. */
  validateAudioFile(file?: UploadedAudioFile): void {
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
   * 말한 출발지나 도착지를 경로 검색 입력으로 바꿉니다. 순서는 현재 위치(출발만), 저장한 집과 학교, 역 이름,
   * 장소 검색이다. 장소 검색 후보가 여럿이면 `candidates`를 돌려줘 사용자에게 묻게 한다
   */
  private async resolveEndpoint(
    userId: string,
    name: string,
    side: EndpointSide,
    dto?: Pick<VoiceRouteRecommendRequestDto, 'lat' | 'lng'>,
  ): Promise<ResolvedPlace> {
    if (side === 'origin' && name === CURRENT_LOCATION) {
      if (dto?.lat === undefined || dto?.lng === undefined) {
        throw new BusinessException(
          'VOICE_ORIGIN_REQUIRED',
          '출발지를 말씀해 주시거나 현재 위치를 켜 주세요.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return {
        endpoint: {
          search: { originLat: dto.lat, originLng: dto.lng },
          label: name,
        },
      };
    }

    const saved = await this.savedPlace(userId, name);
    if (saved) {
      return {
        endpoint: saved.stationId
          ? this.stationEndpoint(side, saved.stationId, name)
          : this.pointEndpoint(side, saved.lat!, saved.lng!, saved.name, name),
      };
    }

    const stationId = this.findStationIdByName(name);
    if (stationId) {
      return {
        endpoint: this.stationEndpoint(side, stationId, `${name}역`),
      };
    }

    // 역 이름이 아니면 장소 이름이나 주소로 보고 후보를 찾는다
    const found = await this.findPlaces(name);
    if (found.length === 0) {
      throw new NotFoundException(
        `${side === 'origin' ? '출발역' : '도착역'} '${name}'을(를) 지하철 노선망에서 찾을 수 없습니다.`,
      );
    }
    const sure = this.pickUnambiguous(found, name);
    if (!sure) return { candidates: found };
    return {
      endpoint:
        sure.type === 'STATION'
          ? this.stationEndpoint(side, sure.stationId, `${sure.name}역`)
          : this.pointEndpoint(side, sure.lat, sure.lng, sure.name, sure.name),
    };
  }

  private stationEndpoint(
    side: EndpointSide,
    stationId: string,
    label: string,
  ): ResolvedEndpoint {
    return {
      stationId,
      search:
        side === 'origin'
          ? { originStationId: stationId }
          : { destinationStationId: stationId },
      label,
    };
  }

  private pointEndpoint(
    side: EndpointSide,
    lat: number,
    lng: number,
    name: string,
    label: string,
  ): ResolvedEndpoint {
    return {
      search:
        side === 'origin'
          ? { originLat: lat, originLng: lng, originName: name }
          : { destinationLat: lat, destinationLng: lng, destinationName: name },
      label,
    };
  }

  /**
   * 말한 이름으로 장소 검색을 해서 후보를 돌려준다. 환승역은 호선마다 한 건씩 나오므로 같은 이름의 역은 하나로 합친다.
   * 검색이 실패하면 후보가 없는 것으로 보고 `404`로 안내한다
   */
  private async findPlaces(name: string): Promise<PlaceSearchResultItemDto[]> {
    let items: PlaceSearchResultItemDto[];
    try {
      ({ items } = await this.placeService.search({
        q: name,
        limit: PLACE_SEARCH_LIMIT,
      }));
    } catch (error) {
      this.logger.warn(
        `place search failed for '${name}': ${(error as Error).message}`,
      );
      return [];
    }
    const seen = new Set<string>();
    return items.filter((item) => {
      if (item.type !== 'STATION') return true;
      const key = comparable(item.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 사용자에게 묻지 않고 바로 안내해도 되는 후보. 후보가 하나뿐이거나, 말한 이름과 이름이 정확히 같은
   * 후보가 하나뿐일 때다(공백과 기호는 무시한다). 그 밖에는 확인이 필요하다
   */
  private pickUnambiguous(
    items: PlaceSearchResultItemDto[],
    spoken: string,
  ): PlaceSearchResultItemDto | undefined {
    if (items.length === 1) return items[0];
    const target = comparable(spoken);
    const exact = items.filter((item) => comparable(item.name) === target);
    return exact.length === 1 ? exact[0] : undefined;
  }

  private toEndpointDto(
    endpoint: ResolvedEndpoint,
    spokenName: string,
    side: EndpointSide,
  ): VoiceOriginDto {
    const { search } = endpoint;
    const name =
      (side === 'origin' ? search.originName : search.destinationName) ??
      spokenName;
    const lat = side === 'origin' ? search.originLat : search.destinationLat;
    const lng = side === 'origin' ? search.originLng : search.destinationLng;
    return {
      name,
      ...(endpoint.stationId ? { stationId: endpoint.stationId } : {}),
      ...(lat !== undefined ? { lat, lng } : {}),
    };
  }

  private toCandidates(
    items: PlaceSearchResultItemDto[],
  ): VoiceDestinationCandidateDto[] {
    return items.slice(0, MAX_CANDIDATES).map((item) => this.toCandidate(item));
  }

  private toCandidate(
    item: PlaceSearchResultItemDto,
  ): VoiceDestinationCandidateDto {
    if (item.type === 'STATION') {
      return {
        type: 'STATION',
        name: item.name,
        lat: item.lat,
        lng: item.lng,
        stationId: item.stationId,
      };
    }
    return {
      type: 'PLACE',
      name: item.name,
      address: item.address,
      ...(item.category ? { category: item.category } : {}),
      lat: item.lat,
      lng: item.lng,
      nearestStation: item.nearestStation,
    };
  }

  /**
   * `집`, `학교`이면 사용자가 저장한 장소를 돌려준다. 장소를 말한 것이 아니면 null이고,
   * 말했는데 저장하지 않았으면 `VOICE_PLACE_NOT_SAVED`(422)다
   */
  private async savedPlace(
    userId: string,
    name: string,
  ): Promise<UserPlace | null> {
    if (!SAVED_PLACE_NAMES.includes(name)) return null;
    const kind = name === HOME_PLACE ? 'HOME' : 'SCHOOL';
    const place = (await this.placeRepo.findAll(userId)).find(
      (candidate) => candidate.kind === kind,
    );
    if (!place) {
      throw new BusinessException(
        'VOICE_PLACE_NOT_SAVED',
        `${name === HOME_PLACE ? '집을' : '학교를'} 아직 저장하지 않았어요. 홈에서 집과 학교를 먼저 저장해 주세요.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return place;
  }

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
