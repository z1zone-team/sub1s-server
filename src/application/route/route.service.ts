import { sliceSegmentStations } from '../../domain/subway/services/track-path';
import { TrackPathService } from './track-path.service';
import { randomUUID } from 'node:crypto';
import {
  ChoiceSnapshot,
  PreferenceModel,
  surveyPreference,
  importance,
} from '../../domain/subway/models/preference-model';
import {
  chooseRecommendation,
  routeFeatures,
  routeFingerprint,
} from '../../domain/subway/models/recommendation-policy';
import { PreferenceModelService } from './preference-model.service';
import {
  IStationFacilityRepository,
  STATION_FACILITY_REPOSITORY,
} from '../../domain/facility/ports/IStationFacilityRepository';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { isWeakAirConditioned } from '../../common/utils/air-conditioning';
import { congestionLevel } from '../../domain/congestion/models/congestion';
import {
  isRouteMode,
  RouteMode,
  RouteNotFoundError,
  RouteResult,
  UnknownStationError,
} from '../../domain/subway/models/route';
import {
  StationRecord,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import {
  ISubwayRouteEngine,
  SUBWAY_ROUTE_ENGINE,
} from '../../domain/subway/ports/ISubwayRouteEngine';
import {
  HighlightInput,
  computeRouteHighlights,
} from '../../domain/subway/models/route-highlight';
import {
  Personalization,
  personalize,
} from '../../domain/subway/services/route-personalizer';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  ITravelLogRepository,
  TRAVEL_LOG_REPOSITORY,
} from '../../domain/travel/ports/ITravelLogRepository';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/user/ports/IUserRepository';
import {
  WalkingService,
  WalkMetrics,
} from '../../domain/subway/services/walking.service';
import {
  GeoPoint,
  IWalkRouteProvider,
  WALK_ROUTE_PROVIDER,
} from '../../domain/subway/ports/IWalkRouteProvider';
import {
  CAR_CONGESTION_PREDICTOR,
  ICarCongestionPredictor,
} from '../../domain/congestion/ports/ICarCongestionPredictor';
import { RouteSearchRequestDto } from './dto/route-search-request.dto';
import { OperationStatusService } from './operation-status.service';
import { ServiceHoursService } from './service-hours.service';
import {
  PathSegmentDto,
  RouteSearchResultDto,
  SubwayRouteOptionDto,
} from './dto/route-search-response.dto';
import { parseIsoAsKst, toKstIso } from '../../common/utils/kst';
import { leastCrowdedCar } from '../../domain/congestion/services/car-congestion';
import { trainCarCount } from '../../domain/congestion/services/train-composition';

/** 로그인하지 않은 사용자에게 주는 모드. 추천(PERSONAL)은 개인화 기능이라 로그인한 사용자에게만 준다 */
const PUBLIC_ROUTE_MODES: RouteMode[] = [
  'OPTIMAL',
  'COMFORTABLE',
  'CHEAPEST',
  'FASTEST',
  'LEAST_WALK',
  'FEWEST_TRANSFERS',
];
const ALL_ROUTE_MODES: RouteMode[] = [
  'OPTIMAL',
  'COMFORTABLE',
  'PERSONAL',
  'CHEAPEST',
  'FASTEST',
  'LEAST_WALK',
  'FEWEST_TRANSFERS',
];
/** 개인화에 쓰는 최근 선택 이력의 건수 */
const HISTORY_LIMIT = 20;

/** 추천 칸이 같은 값으로 동률일 때 칸을 고르는 기준. 같은 구간은 항상 같은 칸이 나온다 */
const carSeed = (segment: {
  lineId: string;
  fromStationId: string;
  direction: string;
}): string => `${segment.lineId}:${segment.fromStationId}:${segment.direction}`;

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);
  private readonly choices = new Map<
    string,
    {
      owner?: string;
      snapshot: ChoiceSnapshot;
      option: SubwayRouteOptionDto;
      expires: number;
    }
  >();

  getChoiceSnapshot(
    routeId?: string,
    userId?: string,
  ): ChoiceSnapshot | undefined {
    if (!routeId) return undefined;
    const record = this.choices.get(routeId);
    if (!record || record.owner !== userId || record.expires < Date.now())
      return undefined;
    return record.snapshot;
  }

  getChosenRoute(
    routeId?: string,
    userId?: string,
  ): SubwayRouteOptionDto | undefined {
    if (!routeId) return undefined;
    const record = this.choices.get(routeId);
    return record && record.owner === userId && record.expires >= Date.now()
      ? record.option
      : undefined;
  }

  constructor(
    @Inject(SUBWAY_ROUTE_ENGINE)
    private readonly routeEngine: ISubwayRouteEngine,
    private readonly graphService: SubwayGraphService,
    @Inject(CAR_CONGESTION_PREDICTOR)
    private readonly congestionProvider: ICarCongestionPredictor,
    private readonly walkingService: WalkingService,
    private readonly operationStatus: OperationStatusService,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @Inject(TRAVEL_LOG_REPOSITORY)
    private readonly travelLogRepo: ITravelLogRepository,
    @Optional() private readonly preferenceModels?: PreferenceModelService,
    @Optional()
    @Inject(WALK_ROUTE_PROVIDER)
    private readonly walkRoutes?: IWalkRouteProvider,
    @Optional() private readonly serviceHours?: ServiceHoursService,
    @Optional()
    @Inject(STATION_FACILITY_REPOSITORY)
    private readonly facilities?: IStationFacilityRepository,
    @Optional() private readonly trackPaths?: TrackPathService,
  ) {}

  /**
   * 사용자가 로그인했으면 설문, 이동 목적, 이전에 고른 모드와 출발 시각으로 추천(PERSONAL) 경로의 가중치를 만든다.
   * 사용자 정보를 읽지 못해도 검색은 막지 않고 기본 가중치로 추천을 낸다
   */
  private async personalizationFor(
    userId: string,
    departureAt: Date,
  ): Promise<
    Personalization & {
      model: PreferenceModel;
      routePrefs: string[];
      fingerprints: string[];
    }
  > {
    try {
      const [preferences, history] = await Promise.all([
        this.userRepo.findPreferences(userId),
        this.travelLogRepo.findRecentRouteChoices(userId, HISTORY_LIMIT),
      ]);
      const model = this.preferenceModels
        ? await this.preferenceModels.compute(
            userId,
            preferences.routePrefs,
            history.flatMap((record) =>
              record.choiceSnapshot ? [record.choiceSnapshot] : [],
            ),
          )
        : surveyPreference(preferences.routePrefs);
      return {
        ...personalize({
          routePrefs: preferences.routePrefs,
          purposes: preferences.purposes,
          history: history.flatMap((record) =>
            isRouteMode(record.routeMode)
              ? [{ mode: record.routeMode, createdAt: record.createdAt }]
              : [],
          ),
          departureAt,
        }),
        model,
        routePrefs: preferences.routePrefs,
        fingerprints: history.flatMap((record) =>
          record.choiceSnapshot?.routeFingerprint
            ? [record.choiceSnapshot.routeFingerprint]
            : [],
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Personalization failed for ${userId}, using the default weights: ${error}`,
      );
      return {
        ...personalize({
          routePrefs: [],
          purposes: [],
          history: [],
          departureAt,
        }),
        model: surveyPreference([]),
        routePrefs: [],
        fingerprints: [],
      };
    }
  }

  async search(
    dto: RouteSearchRequestDto,
    userId?: string,
  ): Promise<RouteSearchResultDto> {
    const departureDate = dto.departureAt
      ? parseIsoAsKst(dto.departureAt)
      : new Date();
    if (Number.isNaN(departureDate.getTime())) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'Invalid departureAt date format (must be ISO-8601)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const graph = this.graphService.getGraph();
    const coordinatesOnly =
      !dto.originStationId &&
      !dto.destinationStationId &&
      dto.originLat !== undefined &&
      dto.originLng !== undefined &&
      dto.destinationLat !== undefined &&
      dto.destinationLng !== undefined;

    // 1. 출발지 역 및 First-Mile 도보 분석
    let originStation: StationRecord;
    let firstMileWalk: WalkMetrics | undefined;

    if (dto.originStationId) {
      const idx = graph.indexOf(dto.originStationId);
      if (idx === undefined) {
        throw new BusinessException(
          'STATION_NOT_FOUND',
          `unknown origin station id: ${dto.originStationId}`,
          HttpStatus.NOT_FOUND,
        );
      }
      originStation = graph.station(idx);
    } else if (dto.originLat !== undefined && dto.originLng !== undefined) {
      const nearest = this.walkingService.findNearestStations(
        graph,
        dto.originLat,
        dto.originLng,
        2.5,
        1,
      );
      if (nearest.length === 0) {
        if (coordinatesOnly)
          return await this.walkOnlyResult(dto, departureDate);
        throw new BusinessException(
          'STATION_NOT_FOUND',
          '출발지 반경 2.5km 이내에 접근 가능한 지하철역이 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }
      originStation = nearest[0].station;
      firstMileWalk = nearest[0].metrics;
    } else {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        '출발역 ID(originStationId) 또는 출발지 좌표(originLat, originLng)를 제공해야 합니다.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. 도착지 역 및 Last-Mile 도보 분석
    let destinationStation: StationRecord;
    let lastMileWalk: WalkMetrics | undefined;

    if (dto.destinationStationId) {
      const idx = graph.indexOf(dto.destinationStationId);
      if (idx === undefined) {
        throw new BusinessException(
          'STATION_NOT_FOUND',
          `unknown destination station id: ${dto.destinationStationId}`,
          HttpStatus.NOT_FOUND,
        );
      }
      destinationStation = graph.station(idx);
    } else if (
      dto.destinationLat !== undefined &&
      dto.destinationLng !== undefined
    ) {
      const nearest = this.walkingService.findNearestStations(
        graph,
        dto.destinationLat,
        dto.destinationLng,
        2.5,
        1,
      );
      if (nearest.length === 0) {
        if (coordinatesOnly)
          return await this.walkOnlyResult(dto, departureDate);
        throw new BusinessException(
          'STATION_NOT_FOUND',
          '도착지 반경 2.5km 이내에 접근 가능한 지하철역이 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }
      destinationStation = nearest[0].station;
      lastMileWalk = nearest[0].metrics;
    } else {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        '도착역 ID(destinationStationId) 또는 도착지 좌표(destinationLat, destinationLng)를 제공해야 합니다.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. 초근거리 직접 도보(ONLY_WALK) 가능 여부 체크
    let directWalkOption: SubwayRouteOptionDto | undefined;
    if (
      dto.originLat !== undefined &&
      dto.originLng !== undefined &&
      dto.destinationLat !== undefined &&
      dto.destinationLng !== undefined
    ) {
      const straightKm = this.straightDistanceKm(dto);

      // 두 지점이 같은 지하철역으로 매핑되거나 1.5km 이내인 경우 도보 경로 생성
      if (originStation.id === destinationStation.id || straightKm <= 1.5) {
        directWalkOption = await this.createDirectWalkOption(
          dto,
          straightKm,
          departureDate,
        );

        // 동일 역 매핑 또는 800m 이내 초근거리는 지하철 탑승 없이 순수 도보만 반환
        if (originStation.id === destinationStation.id || straightKm <= 0.8) {
          return await this.walkOnlyResult(dto, departureDate);
        }
      }
    }

    // 동일 역 검증 (역 ID 직접 입력 시)
    if (originStation.id === destinationStation.id) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        '출발역과 도착역이 동일합니다. 다른 역을 지정해주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. 지하철 모드별 다익스트라 탐색. 추천(PERSONAL)은 로그인한 사용자의 개인화 가중치로만 계산한다
    const personalization = userId
      ? await this.personalizationFor(userId, departureDate)
      : undefined;
    if (personalization) {
      const expressPreference =
        Math.max(0, importance(personalization.model, 'express') - 0.5) * 2;
      const walkingWeight =
        Math.max(0, importance(personalization.model, 'walk') - 0.5) * 2;
      if (expressPreference > 0)
        personalization.weights.expressPreference = expressPreference;
      if (walkingWeight > 0)
        personalization.weights.walkingWeight = walkingWeight;
    }
    const modes = userId ? ALL_ROUTE_MODES : PUBLIC_ROUTE_MODES;
    const origins =
      !dto.originStationId &&
      dto.originLat !== undefined &&
      dto.originLng !== undefined
        ? (this.walkingService.findApproachStations?.(
            graph,
            dto.originLat,
            dto.originLng,
          ) ?? [])
        : [];
    const destinations =
      !dto.destinationStationId &&
      dto.destinationLat !== undefined &&
      dto.destinationLng !== undefined
        ? (this.walkingService.findApproachStations?.(
            graph,
            dto.destinationLat,
            dto.destinationLng,
          ) ?? [])
        : [];
    const originCandidates = await this.withRoutedWalks(
      this.pointOf(dto.originLat, dto.originLng),
      origins.length
        ? origins
        : [{ station: originStation, metrics: firstMileWalk }],
      'TO_STATION',
    );
    const destinationCandidates = await this.withRoutedWalks(
      this.pointOf(dto.destinationLat, dto.destinationLng),
      destinations.length
        ? destinations
        : [{ station: destinationStation, metrics: lastMileWalk }],
      'FROM_STATION',
    );
    const pool: SubwayRouteOptionDto[] = [];
    for (const mode of modes) {
      for (const from of originCandidates)
        for (const to of destinationCandidates) {
          if (from.station.id === to.station.id) continue;
          try {
            const result = await this.routeEngine.findRoute({
              originStationId: from.station.id,
              destinationStationId: to.station.id,
              mode,
              departureAt: new Date(
                departureDate.getTime() +
                  (from.metrics?.durationSec ?? 0) * 1000,
              ),
              weights:
                mode === 'PERSONAL' ? personalization?.weights : undefined,
            });
            pool.push(
              this.mapToOptionDto(
                result,
                graph,
                departureDate,
                dto,
                from.station,
                to.station,
                from.metrics,
                to.metrics,
                mode === 'PERSONAL' &&
                  !!personalization &&
                  importance(personalization.model, 'weakAc') > 0.5,
              ),
            );
          } catch (error) {
            if (!(
              error instanceof RouteNotFoundError ||
              error instanceof UnknownStationError
            ))
              throw error;
          }
        }
    }
    const compareOptions = (
      a: SubwayRouteOptionDto,
      b: SubwayRouteOptionDto,
    ): number => {
      const primary =
        a.mode === 'LEAST_WALK'
          ? (a.totalWalkDistanceKm ?? 0) - (b.totalWalkDistanceKm ?? 0)
          : a.mode === 'FEWEST_TRANSFERS'
            ? a.transferCount - b.transferCount
            : a.mode === 'CHEAPEST'
              ? a.totalFare - b.totalFare
              : a.totalDurationSec - b.totalDurationSec;
      return (
        primary ||
        a.totalDurationSec - b.totalDurationSec ||
        a.totalFare - b.totalFare ||
        (a.stationIds ?? [])
          .join('|')
          .localeCompare((b.stationIds ?? []).join('|'))
      );
    };
    const validOptions = modes.flatMap((mode) => {
      const candidates = pool
        .filter((option) => option.mode === mode)
        .sort(compareOptions);
      return candidates.length ? [candidates[0]] : [];
    });

    if (personalization?.fingerprints.length) {
      pool.forEach((option) => {
        option.familiarity = personalization.fingerprints.includes(
          routeFingerprint(option),
        )
          ? 1
          : 0;
      });
    }
    if (personalization && this.facilities) {
      pool.forEach((option) => {
        option.elevatorAccess = this.elevatorAccess(option);
      });
    }
    const publicPool = pool.filter(
      (option) => option.mode !== 'PERSONAL' && option.mode !== 'ONLY_WALK',
    );
    const common = chooseRecommendation(publicPool);
    const personal = personalization
      ? chooseRecommendation(
          [
            ...publicPool,
            ...pool.filter((option) => option.mode === 'PERSONAL'),
          ],
          personalization.model,
        )
      : undefined;
    if (common) {
      const index = validOptions.findIndex(
        (option) => option.mode === 'OPTIMAL',
      );
      if (index >= 0) validOptions[index] = { ...common, mode: 'OPTIMAL' };
    }
    if (personal) {
      const index = validOptions.findIndex(
        (option) => option.mode === 'PERSONAL',
      );
      if (index >= 0) {
        const preferred = {
          ...personal,
          mode: 'PERSONAL' as const,
          segments: personal.segments.map((segment) => ({ ...segment })),
        };
        if (importance(personalization!.model, 'weakAc') > 0.5) {
          preferred.segments.forEach((segment) => {
            const weakAcCar = leastCrowdedCar(
              segment.cars?.filter((car) => car.isWeakAirConditioned) ?? [],
              carSeed(segment),
            );
            if (weakAcCar) {
              segment.recommendedCarNo = weakAcCar.carNo;
              segment.isWeakAirConditioned = true;
            }
          });
        }
        validOptions[index] = preferred;
      }
    }
    const alternatives = validOptions.map(routeFeatures);
    for (const [id, record] of this.choices)
      if (record.expires < Date.now()) this.choices.delete(id);
    while (this.choices.size > 1000)
      this.choices.delete(this.choices.keys().next().value!);
    for (const option of validOptions) {
      option.routeId = userId ? randomUUID() : undefined;
      if (userId && option.routeId)
        this.choices.set(option.routeId, {
          owner: userId,
          expires: Date.now() + 10 * 60_000,
          option,
          snapshot: {
            selected: routeFeatures(option),
            alternatives,
            routeFingerprint: routeFingerprint(option),
          },
        });
    }
    const unsupportedPreferences =
      personalization?.routePrefs.filter(
        (code) =>
          ['SEAT', 'AVOID_STAIRS'].includes(code) ||
          (code === 'ELEVATOR' &&
            pool.some((option) => option.elevatorAccess === undefined)) ||
          (code === 'FAMILIAR_ROUTE' &&
            !personalization?.fingerprints.length) ||
          (code === 'WEAK_AC' &&
            validOptions
              .find((option) => option.mode === 'PERSONAL')
              ?.segments.some(
                (segment) =>
                  segment.lineId !== 'WALK' && !segment.isWeakAirConditioned,
              )) ||
          (code === 'UNCROWDED' &&
            publicPool.some((option) =>
              option.segments.some(
                (segment) =>
                  segment.lineId !== 'WALK' &&
                  segment.congestionSource !== 'STATISTICS',
              ),
            )),
      ) ?? [];

    // 직접 도보 옵션이 있으면 목록에 병합
    if (directWalkOption) {
      validOptions.push(directWalkOption);
    }

    if (validOptions.length === 0) {
      throw new BusinessException(
        'ROUTE_NOT_FOUND',
        '지정된 구간의 이동 경로를 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }

    this.applyHighlights(validOptions);
    await this.operationStatus.annotate(validOptions, graph);
    await this.serviceHours?.annotate(validOptions, departureDate);

    // 선호 모드가 지정된 경우 우선 배치
    if (dto.routeMode) {
      validOptions.sort((a, b) => {
        if (a.mode === dto.routeMode) return -1;
        if (b.mode === dto.routeMode) return 1;
        return 0;
      });
    }

    return {
      options: validOptions,
      candidateScope: 'MODE_CANDIDATES_NEAREST_3_PHYSICAL_STATIONS_ALL_LINES',
      commonRouteId: validOptions.find((option) => option.mode === 'OPTIMAL')
        ?.routeId,
      ...(personalization
        ? {
            recommendation: {
              context: personalization.context,
              modelVersion: personalization.model.modelVersion,
              preferenceSource: personalization.model.source,
              unsupportedPreferences,
              personalRouteId: validOptions.find(
                (option) => option.mode === 'PERSONAL',
              )?.routeId,
              reasons: personalization.routePrefs
                .filter((code) => !unsupportedPreferences.includes(code))
                .map((code) => `PREF_${code}`),
              usedHistory: personalization.usedHistory,
              fareSensitive: personalization.fareSensitive,
              weights: personalization.weights,
            },
          }
        : {}),
    };
  }

  /**
   * 타고 내리는 역(승차, 하차, 환승) 중 엘리베이터에서 가까운 문 자료가 있는 역의 비율.
   * 한 역이라도 편의시설 자료가 없으면 비교할 수 없으므로 undefined로 둔다
   */
  private elevatorAccess(option: SubwayRouteOptionDto): number | undefined {
    const stops = option.segments
      .filter((segment) => segment.lineId !== 'WALK')
      .flatMap((segment) => [segment.fromStationId, segment.toStationId]);
    if (!stops.length || !this.facilities) return undefined;
    let withElevator = 0;
    for (const stationId of stops) {
      const facilities = this.facilities.findByStationId(stationId);
      if (!facilities) return undefined;
      if (facilities.elevatorDoors.length > 0) withElevator++;
    }
    return withElevator / stops.length;
  }

  private applyHighlights(options: SubwayRouteOptionDto[]): void {
    const comparable = options.filter((option) => option.mode !== 'ONLY_WALK');
    const tags = computeRouteHighlights(comparable.map(toHighlightInput));
    comparable.forEach((option, index) => {
      option.highlights = tags[index];
    });
  }

  private mapToOptionDto(
    result: RouteResult,
    graph: SubwayGraph,
    departureDate: Date,
    dto: RouteSearchRequestDto,
    originStation: StationRecord,
    destinationStation: StationRecord,
    firstMileWalk?: WalkMetrics,
    lastMileWalk?: WalkMetrics,
    preferWeakAc = false,
  ): SubwayRouteOptionDto {
    const segments: PathSegmentDto[] = [];
    let elapsedSec = 0;

    // 1. First-Mile 도보 세그먼트 삽입
    if (firstMileWalk) {
      segments.push({
        operationStatus: 'UNKNOWN',
        lineId: 'WALK',
        direction: 'NONE',
        isExpress: false,
        fromStationId: 'ORIGIN_COORDINATE',
        fromStationName: dto.originName || '출발지',
        toStationId: originStation.id,
        toStationName: originStation.stationName,
        stationCount: 0,
        durationSec: firstMileWalk.durationSec,
        distanceKm: firstMileWalk.actualDistanceKm,
        recommendedCarNo: 0,
        isWeakAirConditioned: false,
        congestionLevel: '여유',
        congestionRate: 0,
        isEstimated: !firstMileWalk.routed,
        walkCalories: firstMileWalk.calories,
        walkSteps: firstMileWalk.steps,
        ...(firstMileWalk.path ? { path: firstMileWalk.path } : {}),
      });
      elapsedSec += firstMileWalk.durationSec;
    }

    // Walking between line nodes before the first train also precedes its congestion prediction.
    let boardingStationId = result.stationIds[0];
    const firstRideStationId = result.segments[0]?.fromStationId;
    const boardingVisited = new Set<string>();
    while (
      firstRideStationId &&
      boardingStationId !== firstRideStationId &&
      !boardingVisited.has(boardingStationId)
    ) {
      boardingVisited.add(boardingStationId);
      const corridor = result.transfers.find(
        (transfer) => transfer.fromStationId === boardingStationId,
      );
      if (!corridor) break;
      elapsedSec += corridor.walkingDurationSec;
      boardingStationId = corridor.toStationId;
    }

    // 2. 지하철 주행 세그먼트
    let stationCursor = 0;
    for (let i = 0; i < result.segments.length; i += 1) {
      const seg = result.segments[i];
      const covered = sliceSegmentStations(
        result.stationIds,
        seg.fromStationId,
        seg.toStationId,
        stationCursor,
      );
      if (covered) stationCursor = covered.next;
      const trackPath = covered
        ? this.trackPaths?.pathFor(covered.ids)
        : undefined;
      const fromStation = graph.station(graph.indexOf(seg.fromStationId)!);
      const toStation = graph.station(graph.indexOf(seg.toStationId)!);
      const segmentDepartureEpoch = departureDate.getTime() + elapsedSec * 1000;

      let nextTransferDoors: string[] | undefined;
      let nextTransferCars: number[] = [];
      if (i < result.segments.length - 1) {
        const nextSeg = result.segments[i + 1];
        const transfer = result.transfers.find(
          (t) => t.fromStationId === seg.toStationId,
        );
        let cursor = seg.toStationId;
        const visited = new Set<string>();
        while (cursor !== nextSeg.fromStationId && !visited.has(cursor)) {
          visited.add(cursor);
          const corridor = result.transfers.find(
            (t) => t.fromStationId === cursor,
          );
          if (!corridor) break;
          elapsedSec += corridor.walkingDurationSec;
          cursor = corridor.toStationId;
        }
        if (transfer) {
          if (
            transfer.recommendedDoors &&
            transfer.recommendedDoors.length > 0
          ) {
            nextTransferDoors = [...transfer.recommendedDoors];
            nextTransferCars = [
              ...new Set(
                transfer.recommendedDoors
                  .map((d) => parseInt(d.split('-')[0], 10))
                  .filter((n) => !Number.isNaN(n)),
              ),
            ];
          }
        }
      }

      // 칸 수를 아는 노선만 칸별로 예측한다. 모르는 노선은 칸 추천 없이(0) 구간 혼잡도만 낸다
      const carCount =
        trainCarCount(seg.lineId, [seg.fromStationId, seg.toStationId]) ?? null;
      const prediction = this.congestionProvider.predictCars(
        seg.lineId,
        seg.fromStationId,
        seg.direction,
        segmentDepartureEpoch,
        nextTransferCars,
        carCount,
      );

      const preferredCars = preferWeakAc
        ? prediction.cars.filter((car) =>
            isWeakAirConditioned(seg.lineId, car.carNo),
          )
        : [];
      const availableCars = preferredCars.length
        ? preferredCars
        : prediction.cars;
      const bestCar = leastCrowdedCar(availableCars, carSeed(seg));
      const recommendedCarNo = bestCar?.carNo ?? 0;
      const weakAc = isWeakAirConditioned(seg.lineId, recommendedCarNo);
      const rate = Math.round(prediction.ratePercent);
      const level = congestionLevel(rate);

      segments.push({
        operationStatus: 'UNKNOWN',
        lineId: seg.lineId,
        direction: seg.direction as 'UP' | 'DOWN' | 'INNER' | 'OUTER',
        isExpress: seg.isExpress,
        fromStationId: seg.fromStationId,
        fromStationName: fromStation.stationName,
        toStationId: seg.toStationId,
        toStationName: toStation.stationName,
        stationCount: seg.stationCount,
        durationSec: seg.durationSec,
        distanceKm: seg.distanceKm,
        boardingAt: toKstIso(segmentDepartureEpoch),
        ...(trackPath ? { path: trackPath } : {}),
        recommendedCarNo,
        recommendedDoors: nextTransferDoors,
        isWeakAirConditioned: weakAc,
        congestionLevel: level,
        congestionRate: rate,
        congestionSource: prediction.source,
        cars: prediction.cars.map((car) => ({
          carNo: car.carNo,
          rate: Math.round(car.rate),
          level: car.level,
          isWeakAirConditioned: isWeakAirConditioned(seg.lineId, car.carNo),
        })),
        isEstimated: seg.isEstimated,
      });

      elapsedSec += seg.durationSec;
    }

    // 3. Last-Mile 도보 세그먼트 삽입
    if (lastMileWalk) {
      segments.push({
        operationStatus: 'UNKNOWN',
        lineId: 'WALK',
        direction: 'NONE',
        isExpress: false,
        fromStationId: destinationStation.id,
        fromStationName: destinationStation.stationName,
        toStationId: 'DEST_COORDINATE',
        toStationName: dto.destinationName || '목적지',
        stationCount: 0,
        durationSec: lastMileWalk.durationSec,
        distanceKm: lastMileWalk.actualDistanceKm,
        recommendedCarNo: 0,
        isWeakAirConditioned: false,
        congestionLevel: '여유',
        congestionRate: 0,
        isEstimated: !lastMileWalk.routed,
        walkCalories: lastMileWalk.calories,
        walkSteps: lastMileWalk.steps,
        ...(lastMileWalk.path ? { path: lastMileWalk.path } : {}),
      });
      elapsedSec += lastMileWalk.durationSec;
    }

    const accessWalkDurationSec =
      (firstMileWalk?.durationSec || 0) + (lastMileWalk?.durationSec || 0);
    const transferWalkDurationSec = result.transfers.reduce(
      (sum, transfer) => sum + transfer.walkingDurationSec,
      0,
    );
    const totalWalkDurationSec =
      accessWalkDurationSec + transferWalkDurationSec;
    const totalWalkDistanceKm =
      (firstMileWalk?.actualDistanceKm ?? 0) +
      (lastMileWalk?.actualDistanceKm ?? 0) +
      (transferWalkDurationSec * 1.2) / 1000;
    const totalCalories =
      (firstMileWalk?.calories || 0) + (lastMileWalk?.calories || 0);
    const totalSteps = (firstMileWalk?.steps || 0) + (lastMileWalk?.steps || 0);

    const totalDurationSec = result.totalDurationSec + accessWalkDurationSec;
    const totalDistanceKm =
      Math.round((result.totalDistanceKm + totalWalkDistanceKm) * 100) / 100;

    const estimatedArrivalTimestamp = toKstIso(
      departureDate.getTime() + totalDurationSec * 1000,
    );

    return {
      mode: result.mode,
      totalDurationSec,
      totalDistanceKm,
      totalFare: result.totalFare,
      transferCount: result.transferCount,
      estimatedArrivalTimestamp,
      segments,
      stationIds: result.stationIds,
      highlights: [],
      operationStatus: 'UNKNOWN',
      totalWalkDurationSec,
      totalWalkDistanceKm,
      walkDistanceSource: walkDistanceSourceOf(
        totalWalkDurationSec,
        transferWalkDurationSec,
        [firstMileWalk, lastMileWalk],
      ),
      totalCalories,
      totalSteps,
    };
  }

  private pointOf(
    lat: number | undefined,
    lng: number | undefined,
  ): GeoPoint | undefined {
    return lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
  }

  /** 실제 보행로를 따라 걸은 도보 지표. 보행 경로를 구하지 못하면(서비스 꺼짐, 시간 초과, 길 없음) undefined라 호출한 쪽이 직선 추정을 쓴다 */
  private async routedWalk(
    from: GeoPoint | undefined,
    to: GeoPoint | undefined,
    straightDistanceKm: number,
  ): Promise<WalkMetrics | undefined> {
    if (!this.walkRoutes || !from || !to) return undefined;
    const leg = await this.walkRoutes.route(from, to);
    return leg
      ? this.walkingService.metricsForRoutedDistance(
          straightDistanceKm,
          leg.distanceM / 1000,
          leg.polyline,
        )
      : undefined;
  }

  /**
   * 출발지(또는 도착지) 좌표와 후보 역 사이의 도보를 실제 보행로로 바꾼다. 후보마다 따로 구하고,
   * 구하지 못한 후보는 직선 추정을 그대로 둔다. 좌표가 없으면(역으로 정한 출발지) 그대로 돌려준다
   */
  private async withRoutedWalks<
    T extends { station: StationRecord; metrics?: WalkMetrics },
  >(
    point: GeoPoint | undefined,
    candidates: T[],
    direction: 'TO_STATION' | 'FROM_STATION',
  ): Promise<T[]> {
    if (!point || !this.walkRoutes) return candidates;
    return Promise.all(
      candidates.map(async (candidate) => {
        if (!candidate.metrics) return candidate;
        const station = {
          lat: candidate.station.lat,
          lng: candidate.station.lng,
        };
        const routed = await this.routedWalk(
          direction === 'TO_STATION' ? point : station,
          direction === 'TO_STATION' ? station : point,
          candidate.metrics.straightDistanceKm,
        );
        return routed ? { ...candidate, metrics: routed } : candidate;
      }),
    );
  }

  /** 출발지와 도착지 좌표의 직선 거리. 같은 위치(50m 미만)는 요청 오류다 */
  private straightDistanceKm(dto: RouteSearchRequestDto): number {
    const straightKm = this.walkingService.haversineDistanceKm(
      dto.originLat as number,
      dto.originLng as number,
      dto.destinationLat as number,
      dto.destinationLng as number,
    );
    if (straightKm < 0.05) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        '출발지와 도착지가 동일한 위치입니다.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return straightKm;
  }

  /** 지하철을 타지 않는 도보 경로 하나만 담은 결과 */
  private async walkOnlyResult(
    dto: RouteSearchRequestDto,
    departureDate: Date,
  ): Promise<RouteSearchResultDto> {
    const option = await this.createDirectWalkOption(
      dto,
      this.straightDistanceKm(dto),
      departureDate,
    );
    return {
      options: [option],
      aiBriefingText: `목적지까지 약 ${Math.round(option.totalDurationSec / 60)}분 소요되는 도보 이동을 추천합니다.`,
    };
  }

  private async createDirectWalkOption(
    dto: RouteSearchRequestDto,
    straightDistanceKm: number,
    departureDate: Date,
  ): Promise<SubwayRouteOptionDto> {
    const estimate =
      this.walkingService.calculateWalkMetrics(straightDistanceKm);
    const metrics =
      (await this.routedWalk(
        this.pointOf(dto.originLat, dto.originLng),
        this.pointOf(dto.destinationLat, dto.destinationLng),
        straightDistanceKm,
      )) ?? estimate;
    const estimatedArrivalTimestamp = toKstIso(
      departureDate.getTime() + metrics.durationSec * 1000,
    );

    return {
      mode: 'ONLY_WALK',
      totalDurationSec: metrics.durationSec,
      totalDistanceKm: metrics.actualDistanceKm,
      totalFare: 0,
      transferCount: 0,
      estimatedArrivalTimestamp,
      segments: [
        {
          operationStatus: 'UNKNOWN',
          lineId: 'WALK',
          direction: 'NONE',
          isExpress: false,
          fromStationId: 'ORIGIN_COORDINATE',
          fromStationName: dto.originName || '출발지',
          toStationId: 'DEST_COORDINATE',
          toStationName: dto.destinationName || '목적지',
          stationCount: 0,
          durationSec: metrics.durationSec,
          distanceKm: metrics.actualDistanceKm,
          recommendedCarNo: 0,
          isWeakAirConditioned: false,
          congestionLevel: '여유',
          congestionRate: 0,
          isEstimated: !metrics.routed,
          walkCalories: metrics.calories,
          walkSteps: metrics.steps,
          ...(metrics.path ? { path: metrics.path } : {}),
        },
      ],
      highlights: [],
      operationStatus: 'UNKNOWN',
      totalWalkDurationSec: metrics.durationSec,
      totalWalkDistanceKm: metrics.actualDistanceKm,
      walkDistanceSource: metrics.routed ? 'ROUTED' : 'ESTIMATED',
      totalCalories: metrics.calories,
      totalSteps: metrics.steps,
    };
  }
}

/**
 * 도보거리의 출처. 출발지, 도착지 쪽 도보를 모두 실제 보행로로 구했고 환승 걷기가 없을 때만 ROUTED다.
 * 환승 걷기(시간 환산)나 직선 추정이 하나라도 섞이면 ESTIMATED다
 */
function walkDistanceSourceOf(
  totalWalkDurationSec: number,
  transferWalkDurationSec: number,
  accessWalks: Array<WalkMetrics | undefined>,
): 'ROUTED' | 'ESTIMATED' | 'NONE' {
  if (totalWalkDurationSec <= 0) return 'NONE';
  const legs = accessWalks.filter((walk): walk is WalkMetrics => !!walk);
  return legs.length > 0 &&
    transferWalkDurationSec === 0 &&
    legs.every((walk) => walk.routed)
    ? 'ROUTED'
    : 'ESTIMATED';
}

const CAR_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function toHighlightInput(option: SubwayRouteOptionDto): HighlightInput {
  const rides = option.segments.filter((segment) => segment.lineId !== 'WALK');
  const rideSec = rides.reduce((sum, segment) => sum + segment.durationSec, 0);
  const endpointWalkSec = option.totalWalkDurationSec ?? 0;
  const transferWalkSec = Math.max(
    0,
    option.totalDurationSec - endpointWalkSec - rideSec,
  );

  return {
    totalDurationSec: option.totalDurationSec,
    transferCount: option.transferCount,
    totalFare: option.totalFare,
    averageCongestionRate:
      rideSec > 0
        ? rides.reduce(
            (sum, segment) =>
              sum + segment.congestionRate * segment.durationSec,
            0,
          ) / rideSec
        : null,
    walkSec: endpointWalkSec + transferWalkSec,
    hasWeakAcCar: mostlyOnWeakAcLines(rides, rideSec),
  };
}

// 약냉방칸이 있는 노선에서 탑승 시간의 절반 이상을 보낼 때만 약냉방칸 선호에 맞는다고 본다
function mostlyOnWeakAcLines(
  rides: PathSegmentDto[],
  rideSec: number,
): boolean {
  if (rideSec <= 0) return false;
  const weakAcSec = rides
    .filter((segment) => lineHasWeakAcCars(segment.lineId))
    .reduce((sum, segment) => sum + segment.durationSec, 0);
  return weakAcSec * 2 >= rideSec;
}

function lineHasWeakAcCars(lineId: string): boolean {
  return CAR_NUMBERS.some((carNo) => isWeakAirConditioned(lineId, carNo));
}
