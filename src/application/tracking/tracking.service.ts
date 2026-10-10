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
import {
  OffRouteAlertReason,
  TrackingSession,
} from '../../domain/tracking/models/tracking-session';
import {
  ITrackingRepository,
  TRACKING_REPOSITORY,
} from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
import { PathSegmentDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import {
  DeviateCheckRequestDto,
  OffRouteAlertDto,
  StartTrackingRequestDto,
  TrackingSessionDto,
} from './dto';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @Inject(TRACKING_REPOSITORY)
    private readonly trackingRepository: ITrackingRepository,
    private readonly offRouteDetector: OffRouteDetector,
    private readonly graphService: SubwayGraphService,
    private readonly routeService: RouteService,
    @Optional()
    private readonly subwayEventsGateway?: SubwayEventsGateway,
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

    const graph = this.graphService.getGraph();
    const allStationIds =
      dto.stationIds && dto.stationIds.length > 0
        ? dto.stationIds
        : this.expandStationIds(graph, dto.routeOption.segments);

    const originStationId = allStationIds[0];
    const destStationId = allStationIds[allStationIds.length - 1];
    const expectedRemainingStationIds = allStationIds.slice(1);
    const nextStationId = expectedRemainingStationIds[0] ?? destStationId;

    const now = new Date();
    const session: TrackingSession = {
      sessionId: randomUUID(),
      userId,
      routeOption: dto.routeOption,
      allStationIds,
      originStationId,
      destStationId,
      currentStationId: originStationId,
      nextStationId,
      expectedRemainingStationIds,
      remainingDurationSec: dto.routeOption.totalDurationSec,
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

    // Case 2: Deviation / Off-route detected -> emergency reroute within SLA (< 3 seconds)
    const detectedStation = graph.station(detectedIndex);
    const reason = this.determineDeviationReason(
      session,
      detectedStation.lineId,
    );

    // Calculate reroute option from detected station to original destination
    const rerouteResult = await this.routeService.search({
      originStationId: dto.detectedStationId,
      destinationStationId: session.destStationId,
      routeMode: 'OPTIMAL',
    });

    const rerouteOption = rerouteResult.options[0];
    session.isOffRoute = true;
    session.currentStationId = dto.detectedStationId;
    session.updatedAt = new Date();
    await this.trackingRepository.save(session);

    const alertDto: OffRouteAlertDto = {
      sessionId: session.sessionId,
      detectedStationId: dto.detectedStationId,
      detectedStationName: detectedStation.stationName,
      reason,
      message:
        '경로를 이탈했습니다. 다음 역에서 즉시 하차하여 맞은편 승강장으로 이동하세요.',
      rerouteOption,
      isOffRoute: true,
    };

    // Broadcast alert via WebSocket gateway if available
    try {
      this.subwayEventsGateway?.sendOffRouteAlert(session.userId, alertDto);
    } catch (err) {
      this.logger.warn(`Failed to emit offroute alert to websocket: ${err}`);
    }

    return alertDto;
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

  // Another user's session is reported as missing, so a session id never reveals that it exists.
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
