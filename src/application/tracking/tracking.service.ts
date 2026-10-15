import { randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { WalkingService } from '../../domain/subway/services/walking.service';
import {
  OffRouteAlertReason,
  TrackingSession,
} from '../../domain/tracking/models/tracking-session';
import {
  ITrackingRepository,
  TRACKING_REPOSITORY,
} from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { PathSegmentDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import {
  DeviateCheckRequestDto,
  OffRouteAlertDto,
  ReportPositionRequestDto,
  StartTrackingRequestDto,
  TrackingSessionDto,
} from './dto';
import { OffRouteNotifier } from './off-route.notifier';

/** 좌표가 이 거리 안의 역 근처일 때만 위치를 판단한다 */
const POSITION_RADIUS_KM = 0.3;

/** 경로에 없는 역이 이만큼 연달아 감지되면 이탈로 본다. 한 번은 승강장 이동이나 지상 보행일 수 있다 */
const OFF_ROUTE_MISS_LIMIT = 2;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @Inject(TRACKING_REPOSITORY)
    private readonly trackingRepository: ITrackingRepository,
    private readonly offRouteDetector: OffRouteDetector,
    private readonly graphService: SubwayGraphService,
    private readonly routeService: RouteService,
    private readonly walkingService: WalkingService,
    @Optional()
    private readonly offRouteNotifier?: OffRouteNotifier,
  ) {}

  async startTracking(
    userId: string,
    dto: StartTrackingRequestDto,
  ): Promise<TrackingSessionDto> {
    if (
      !dto.routeOption ||
      !dto.routeOption.segments ||
      dto.routeOption.segments.length === 0
    ) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'routeOption must contain at least one segment',
        HttpStatus.BAD_REQUEST,
      );
    }

    const selectedRoute = this.routeService.getChosenRoute?.(
      dto.routeOption.routeId,
      userId,
    );
    if (dto.routeOption.routeId && !selectedRoute) {
      throw new BusinessException(
        'ROUTE_CHOICE_EXPIRED',
        '경로 선택이 만료됐어요. 다시 검색해 주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tracked = selectedRoute ?? dto.routeOption;
    const graph = this.graphService.getGraph();
    const allStationIds = selectedRoute?.stationIds?.length
      ? selectedRoute.stationIds
      : dto.stationIds && dto.stationIds.length > 0
        ? dto.stationIds
        : this.expandStationIds(graph, tracked.segments);

    const originStationId = allStationIds[0];
    const destStationId = allStationIds[allStationIds.length - 1];
    const expectedRemainingStationIds = allStationIds.slice(1);
    const nextStationId = expectedRemainingStationIds[0] ?? destStationId;

    const now = new Date();
    const session: TrackingSession = {
      sessionId: randomUUID(),
      userId,
      routeOption: tracked,
      choiceSnapshot: this.routeService.getChoiceSnapshot?.(
        dto.routeOption.routeId,
        userId,
      ),
      allStationIds,
      originStationId,
      destStationId,
      currentStationId: originStationId,
      nextStationId,
      expectedRemainingStationIds,
      remainingDurationSec: tracked.totalDurationSec,
      isOffRoute: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.trackingRepository.save(session);
    this.logger.debug(
      `Started tracking session ${session.sessionId}: ${originStationId} -> ${destStationId}`,
    );

    return this.toSessionDto(session, graph);
  }

  async checkDeviate(
    userId: string,
    dto: DeviateCheckRequestDto,
  ): Promise<OffRouteAlertDto | TrackingSessionDto> {
    const session = await this.findOwnedSession(userId, dto.sessionId);

    const graph = this.graphService.getGraph();
    const detectedIndex = graph.indexOf(dto.detectedStationId);
    if (detectedIndex === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `detected station id not found: ${dto.detectedStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const deviationResult = this.offRouteDetector.evaluateDeviation(
      session.expectedRemainingStationIds,
      session.currentStationId,
      dto.detectedStationId,
      dto.isUserConfirmed ?? false,
    );

    // Case 1: User is still on route
    if (!deviationResult.shouldReroute) {
      this.advanceOnRoute(session, dto.detectedStationId);
      await this.trackingRepository.save(session);
      return this.toSessionDto(session, graph);
    }

    return this.buildOffRouteAlert(session, graph, dto.detectedStationId);
  }

  async reportPosition(
    userId: string,
    dto: ReportPositionRequestDto,
  ): Promise<OffRouteAlertDto | TrackingSessionDto> {
    const session = await this.findOwnedSession(userId, dto.sessionId);
    const graph = this.graphService.getGraph();

    const nearest = this.walkingService.findNearestStations(
      graph,
      dto.lat,
      dto.lng,
      POSITION_RADIUS_KM,
      1,
    )[0];
    if (!nearest) return this.toSessionDto(session, graph);

    const routeStationId = this.findRouteStationByName(
      session,
      graph,
      nearest.station.stationName,
    );
    if (routeStationId) {
      session.offRouteMisses = 0;
      if (
        routeStationId === session.currentStationId ||
        session.expectedRemainingStationIds.includes(routeStationId)
      ) {
        this.advanceOnRoute(session, routeStationId);
      }
      await this.trackingRepository.save(session);
      return this.toSessionDto(session, graph);
    }

    session.offRouteMisses = (session.offRouteMisses ?? 0) + 1;
    if (session.offRouteMisses < OFF_ROUTE_MISS_LIMIT) {
      await this.trackingRepository.save(session);
      return this.toSessionDto(session, graph);
    }

    return this.buildOffRouteAlert(session, graph, nearest.station.id);
  }

  async reportLocation(
    userId: string,
    sessionId: string,
    currentStationId: string,
  ): Promise<TrackingSessionDto> {
    const session = await this.findOwnedSession(userId, sessionId);

    const graph = this.graphService.getGraph();
    const stIndex = graph.indexOf(currentStationId);
    if (stIndex === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `station id not found: ${currentStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.advanceOnRoute(session, currentStationId);
    await this.trackingRepository.save(session);
    return this.toSessionDto(session, graph);
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<TrackingSessionDto> {
    const session = await this.findOwnedSession(userId, sessionId);
    const graph = this.graphService.getGraph();
    return this.toSessionDto(session, graph);
  }

  // 다른 사용자의 세션은 없는 세션처럼 응답해 세션 ID의 존재 여부가 드러나지 않게 한다
  private async findOwnedSession(
    userId: string,
    sessionId: string,
  ): Promise<TrackingSession> {
    const session = await this.trackingRepository.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new BusinessException(
        'SESSION_NOT_FOUND',
        `tracking session not found: ${sessionId}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return session;
  }

  private async buildOffRouteAlert(
    session: TrackingSession,
    graph: SubwayGraph,
    detectedStationId: string,
  ): Promise<OffRouteAlertDto> {
    const detectedIndex = graph.indexOf(detectedStationId)!;
    const detectedStation = graph.station(detectedIndex);
    const reason = this.determineDeviationReason(
      session,
      detectedStation.lineId,
    );

    const rerouteResult = await this.routeService.search({
      originStationId: detectedStationId,
      destinationStationId: session.destStationId,
      routeMode: 'OPTIMAL',
    });

    const rerouteOption = rerouteResult.options[0];
    session.isOffRoute = true;
    session.currentStationId = detectedStationId;
    session.updatedAt = new Date();
    await this.trackingRepository.save(session);

    const alertDto: OffRouteAlertDto = {
      sessionId: session.sessionId,
      detectedStationId,
      detectedStationName: detectedStation.stationName,
      reason,
      message:
        '경로를 이탈했습니다. 다음 역에서 즉시 하차하여 맞은편 승강장으로 이동하세요.',
      rerouteOption,
      isOffRoute: true,
    };

    try {
      this.offRouteNotifier?.sendOffRouteAlert(session.userId, alertDto);
    } catch (err) {
      this.logger.warn(`Failed to emit offroute alert to websocket: ${err}`);
    }

    return alertDto;
  }

  // 환승역은 호선마다 역 ID가 달라서 이름으로 비교하고, 경로가 쓰는 역 ID를 돌려준다
  private findRouteStationByName(
    session: TrackingSession,
    graph: SubwayGraph,
    stationName: string,
  ): string | undefined {
    return session.allStationIds.find((id) => {
      const index = graph.indexOf(id);
      return (
        index !== undefined && graph.station(index).stationName === stationName
      );
    });
  }

  private advanceOnRoute(
    session: TrackingSession,
    detectedStationId: string,
  ): void {
    session.currentStationId = detectedStationId;
    session.isOffRoute = false;
    session.updatedAt = new Date();

    const idx = session.expectedRemainingStationIds.indexOf(detectedStationId);
    if (idx !== -1) {
      session.expectedRemainingStationIds =
        session.expectedRemainingStationIds.slice(idx + 1);
    }

    session.nextStationId =
      session.expectedRemainingStationIds[0] ?? session.destStationId;
  }

  private determineDeviationReason(
    session: TrackingSession,
    detectedLineId: string,
  ): OffRouteAlertReason {
    const currentSegment = session.routeOption.segments[0];
    if (currentSegment && currentSegment.lineId === detectedLineId) {
      return 'WRONG_DIRECTION';
    }
    return 'SKIPPED_TRANSFER';
  }

  private expandStationIds(
    graph: SubwayGraph,
    segments: PathSegmentDto[],
  ): string[] {
    const stationIds: string[] = [];

    for (const seg of segments) {
      const fromIdx = graph.indexOf(seg.fromStationId);
      const targetIndex = graph.indexOf(seg.toStationId);

      if (fromIdx === undefined || targetIndex === undefined) {
        if (!stationIds.includes(seg.fromStationId))
          stationIds.push(seg.fromStationId);
        if (!stationIds.includes(seg.toStationId))
          stationIds.push(seg.toStationId);
        continue;
      }

      if (
        stationIds.length === 0 ||
        stationIds[stationIds.length - 1] !== seg.fromStationId
      ) {
        stationIds.push(seg.fromStationId);
      }

      let currIndex: number = fromIdx;
      let steps = 0;
      const maxSteps = Math.max(seg.stationCount * 2 + 5, 50);

      while (currIndex !== targetIndex && steps < maxSteps) {
        steps++;
        const edges = graph
          .edgesFrom(currIndex)
          .filter(
            (e) =>
              e.lineId === seg.lineId &&
              (e.direction === seg.direction || !seg.direction),
          );

        if (edges.length === 0) {
          break;
        }

        const matchedEdge =
          edges.find((e) => e.isExpress === seg.isExpress) ?? edges[0];
        currIndex = matchedEdge.toIndex;
        stationIds.push(graph.station(currIndex).id);
      }

      if (stationIds[stationIds.length - 1] !== seg.toStationId) {
        stationIds.push(seg.toStationId);
      }
    }

    return stationIds;
  }

  private toSessionDto(
    session: TrackingSession,
    graph: SubwayGraph,
  ): TrackingSessionDto {
    const currentStation = graph.station(
      graph.indexOf(session.currentStationId)!,
    );
    const nextStation = graph.station(graph.indexOf(session.nextStationId)!);
    const destStation = graph.station(graph.indexOf(session.destStationId)!);

    return {
      sessionId: session.sessionId,
      currentStationId: session.currentStationId,
      currentStationName: currentStation
        ? currentStation.stationName
        : session.currentStationId,
      nextStationId: session.nextStationId,
      nextStationName: nextStation
        ? nextStation.stationName
        : session.nextStationId,
      destStationId: session.destStationId,
      destStationName: destStation
        ? destStation.stationName
        : session.destStationId,
      remainingDurationSec: session.remainingDurationSec,
      isOffRoute: session.isOffRoute,
      expectedRemainingStationIds: [...session.expectedRemainingStationIds],
    };
  }
}
