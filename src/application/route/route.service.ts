import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { isWeakAirConditioned } from '../../common/utils/air-conditioning';
import { congestionLevel } from '../../domain/congestion/models/congestion';
import {
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
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  WalkingService,
  WalkMetrics,
} from '../../domain/subway/services/walking.service';
import { StatisticalCongestionProvider } from '../../infra/congestion/statistical-congestion.provider';
import { RouteSearchRequestDto } from './dto/route-search-request.dto';
import {
  PathSegmentDto,
  RouteSearchResultDto,
  SubwayRouteOptionDto,
} from './dto/route-search-response.dto';
import { parseIsoAsKst, toKstIso } from '../../common/utils/kst';

const ALL_ROUTE_MODES: RouteMode[] = [
  'OPTIMAL',
  'COMFORTABLE',
  'PERSONAL',
  'CHEAPEST',
];

@Injectable()
export class RouteService {
  constructor(
    @Inject(SUBWAY_ROUTE_ENGINE)
    private readonly routeEngine: ISubwayRouteEngine,
    private readonly graphService: SubwayGraphService,
    private readonly congestionProvider: StatisticalCongestionProvider,
    private readonly walkingService: WalkingService,
  ) {}

  async search(dto: RouteSearchRequestDto): Promise<RouteSearchResultDto> {
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
      const straightKm = this.walkingService.haversineDistanceKm(
        dto.originLat,
        dto.originLng,
        dto.destinationLat,
        dto.destinationLng,
      );

      if (straightKm < 0.05) {
        throw new BusinessException(
          'INVALID_REQUEST_PAYLOAD',
          '출발지와 도착지가 동일한 위치입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 두 지점이 같은 지하철역으로 매핑되거나 1.5km 이내인 경우 도보 경로 생성
      if (originStation.id === destinationStation.id || straightKm <= 1.5) {
        directWalkOption = this.createDirectWalkOption(
          dto,
          straightKm,
          departureDate,
        );

        // 동일 역 매핑 또는 800m 이내 초근거리는 지하철 탑승 없이 순수 도보만 반환
        if (originStation.id === destinationStation.id || straightKm <= 0.8) {
          return {
            options: [directWalkOption],
            aiBriefingText: `목적지까지 약 ${Math.round(directWalkOption.totalDurationSec / 60)}분 소요되는 도보 이동을 추천합니다.`,
          };
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

    // 4. 지하철 4대 모드 다익스트라 탐색
    const optionResults = await Promise.all(
      ALL_ROUTE_MODES.map(async (mode) => {
        try {
          const result = await this.routeEngine.findRoute({
            originStationId: originStation.id,
            destinationStationId: destinationStation.id,
            mode,
            departureAt: departureDate,
            weights:
              mode === 'PERSONAL'
                ? { congestion: 1.5, transferSec: 240 }
                : undefined,
          });
          return this.mapToOptionDto(
            result,
            graph,
            departureDate,
            dto,
            originStation,
            destinationStation,
            firstMileWalk,
            lastMileWalk,
          );
        } catch (error) {
          if (
            error instanceof RouteNotFoundError ||
            error instanceof UnknownStationError
          ) {
            return null;
          }
          throw error;
        }
      }),
    );

    const validOptions = optionResults.filter(
      (opt): opt is SubwayRouteOptionDto => opt !== null,
    );

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

    // 선호 모드가 지정된 경우 우선 배치
    if (dto.routeMode) {
      validOptions.sort((a, b) => {
        if (a.mode === dto.routeMode) return -1;
        if (b.mode === dto.routeMode) return 1;
        return 0;
      });
    }

    return { options: validOptions };
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
  ): SubwayRouteOptionDto {
    const segments: PathSegmentDto[] = [];
    let elapsedSec = 0;

    // 1. First-Mile 도보 세그먼트 삽입
    if (firstMileWalk) {
      segments.push({
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
        isEstimated: false,
        walkCalories: firstMileWalk.calories,
        walkSteps: firstMileWalk.steps,
      });
      elapsedSec += firstMileWalk.durationSec;
    }

    // 2. 지하철 주행 세그먼트
    for (let i = 0; i < result.segments.length; i += 1) {
      const seg = result.segments[i];
      const fromStation = graph.station(graph.indexOf(seg.fromStationId)!);
      const toStation = graph.station(graph.indexOf(seg.toStationId)!);
      const segmentDepartureEpoch = departureDate.getTime() + elapsedSec * 1000;

      let nextTransferDoors: string[] | undefined;
      let nextTransferCars: number[] = [];
      if (i < result.segments.length - 1) {
        const nextSeg = result.segments[i + 1];
        const transfer = result.transfers.find(
          (t) =>
            t.fromStationId === seg.toStationId &&
            t.toStationId === nextSeg.fromStationId,
        );
        if (transfer) {
          elapsedSec += transfer.walkingDurationSec;
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

      const prediction = this.congestionProvider.predictCars(
        seg.lineId,
        seg.fromStationId,
        seg.direction,
        segmentDepartureEpoch,
        nextTransferCars,
      );

      let bestCar = prediction.cars[0];
      for (const car of prediction.cars) {
        if (car.rate < bestCar.rate) {
          bestCar = car;
        }
      }

      const recommendedCarNo = bestCar.carNo;
      const weakAc = isWeakAirConditioned(seg.lineId, recommendedCarNo);
      const rate = Math.round(prediction.ratePercent);
      const level = congestionLevel(rate);

      segments.push({
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
        recommendedCarNo,
        recommendedDoors: nextTransferDoors,
        isWeakAirConditioned: weakAc,
        congestionLevel: level,
        congestionRate: rate,
        congestionSource: prediction.source,
        isEstimated: seg.isEstimated,
      });

      elapsedSec += seg.durationSec;
    }

    // 3. Last-Mile 도보 세그먼트 삽입
    if (lastMileWalk) {
      segments.push({
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
        isEstimated: false,
        walkCalories: lastMileWalk.calories,
        walkSteps: lastMileWalk.steps,
      });
      elapsedSec += lastMileWalk.durationSec;
    }

    const totalWalkDurationSec =
      (firstMileWalk?.durationSec || 0) + (lastMileWalk?.durationSec || 0);
    const totalWalkDistanceKm =
      Math.round(
        ((firstMileWalk?.actualDistanceKm || 0) +
          (lastMileWalk?.actualDistanceKm || 0)) *
          100,
      ) / 100;
    const totalCalories =
      (firstMileWalk?.calories || 0) + (lastMileWalk?.calories || 0);
    const totalSteps = (firstMileWalk?.steps || 0) + (lastMileWalk?.steps || 0);

    const totalDurationSec = result.totalDurationSec + totalWalkDurationSec;
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
      totalWalkDurationSec,
      totalWalkDistanceKm,
      totalCalories,
      totalSteps,
    };
  }

  private createDirectWalkOption(
    dto: RouteSearchRequestDto,
    straightDistanceKm: number,
    departureDate: Date,
  ): SubwayRouteOptionDto {
    const metrics =
      this.walkingService.calculateWalkMetrics(straightDistanceKm);
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
          isEstimated: false,
          walkCalories: metrics.calories,
          walkSteps: metrics.steps,
        },
      ],
      totalWalkDurationSec: metrics.durationSec,
      totalWalkDistanceKm: metrics.actualDistanceKm,
      totalCalories: metrics.calories,
      totalSteps: metrics.steps,
    };
  }
}
