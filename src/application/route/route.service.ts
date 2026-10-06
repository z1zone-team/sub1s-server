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
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  ISubwayRouteEngine,
  SUBWAY_ROUTE_ENGINE,
} from '../../domain/subway/ports/ISubwayRouteEngine';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { StatisticalCongestionProvider } from '../../infra/congestion/statistical-congestion.provider';
import { RouteSearchRequestDto } from './dto/route-search-request.dto';
import {
  PathSegmentDto,
  RouteSearchResultDto,
  SubwayRouteOptionDto,
} from './dto/route-search-response.dto';

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
  ) {}

  async search(dto: RouteSearchRequestDto): Promise<RouteSearchResultDto> {
    const departureDate = dto.departureAt ? new Date(dto.departureAt) : new Date();
    if (Number.isNaN(departureDate.getTime())) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'Invalid departureAt date format (must be ISO-8601)',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.originStationId === dto.destinationStationId) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'origin and destination must be different stations',
        HttpStatus.BAD_REQUEST,
      );
    }

    const graph = this.graphService.getGraph();
    const originIndex = graph.indexOf(dto.originStationId);
    if (originIndex === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `unknown origin station id: ${dto.originStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const destinationIndex = graph.indexOf(dto.destinationStationId);
    if (destinationIndex === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `unknown destination station id: ${dto.destinationStationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Compute all 4 modes in parallel
    const optionResults = await Promise.all(
      ALL_ROUTE_MODES.map(async (mode) => {
        try {
          const result = await this.routeEngine.findRoute({
            originStationId: dto.originStationId,
            destinationStationId: dto.destinationStationId,
            mode,
            departureAt: departureDate,
            // Default personal preference weights when not authenticated
            weights:
              mode === 'PERSONAL'
                ? { congestion: 1.5, transferSec: 240 }
                : undefined,
          });
          return this.mapToOptionDto(result, graph, departureDate);
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

    if (validOptions.length === 0) {
      throw new BusinessException(
        'ROUTE_NOT_FOUND',
        'no route found between the specified stations',
        HttpStatus.NOT_FOUND,
      );
    }

    // If a specific mode was requested, move it to the front
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
  ): SubwayRouteOptionDto {
    const segments: PathSegmentDto[] = [];
    let elapsedSec = 0;

    for (let i = 0; i < result.segments.length; i += 1) {
      const seg = result.segments[i];
      const fromStation = graph.station(graph.indexOf(seg.fromStationId)!);
      const toStation = graph.station(graph.indexOf(seg.toStationId)!);
      const segmentDepartureEpoch =
        departureDate.getTime() + elapsedSec * 1000;

      // Predict congestion and train cars for this segment
      const prediction = this.congestionProvider.predictCars(
        seg.lineId,
        seg.fromStationId,
        seg.direction,
        segmentDepartureEpoch,
      );

      // Find recommended car (lowest congestion rate)
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
        isWeakAirConditioned: weakAc,
        congestionLevel: level,
        congestionRate: rate,
        isEstimated: seg.isEstimated,
      });

      elapsedSec += seg.durationSec;

      // Add transfer walking time if transferring to next segment
      if (i < result.segments.length - 1) {
        const nextSeg = result.segments[i + 1];
        const transfer = result.transfers.find(
          (t) =>
            t.fromStationId === seg.toStationId &&
            t.toStationId === nextSeg.fromStationId,
        );
        if (transfer) {
          elapsedSec += transfer.walkingDurationSec;
        }
      }
    }

    const estimatedArrivalTimestamp = new Date(
      departureDate.getTime() + result.totalDurationSec * 1000,
    ).toISOString();

    return {
      mode: result.mode,
      totalDurationSec: result.totalDurationSec,
      totalDistanceKm: result.totalDistanceKm,
      totalFare: result.totalFare,
      transferCount: result.transferCount,
      estimatedArrivalTimestamp,
      segments,
    };
  }
}
