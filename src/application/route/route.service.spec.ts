import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RouteResult } from '../../domain/subway/models/route';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  ISubwayRouteEngine,
  SUBWAY_ROUTE_ENGINE,
} from '../../domain/subway/ports/ISubwayRouteEngine';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { WalkingService } from '../../domain/subway/services/walking.service';
import { StatisticalCongestionProvider } from '../../infra/congestion/statistical-congestion.provider';
import { RouteService } from './route.service';

describe('RouteService', () => {
  let service: RouteService;
  let mockEngine: jest.Mocked<ISubwayRouteEngine>;
  let mockGraphService: { getGraph: jest.Mock };
  let mockCongestionProvider: { predictCars: jest.Mock };

  const testGraph = new SubwayGraph({
    stations: [
      {
        id: '02_222',
        lineId: '02',
        stationName: '강남',
        lat: 37.4979,
        lng: 127.0276,
        lineSeq: 1,
      },
      {
        id: '02_221',
        lineId: '02',
        stationName: '역삼',
        lat: 37.5006,
        lng: 127.0364,
        lineSeq: 2,
      },
      {
        id: '03_336',
        lineId: '03',
        stationName: '양재',
        lat: 37.4845,
        lng: 127.0343,
        lineSeq: 1,
      },
    ],
    edges: [
      {
        fromStationId: '02_222',
        toStationId: '02_221',
        lineId: '02',
        direction: 'INNER',
        isExpress: false,
        distanceKm: 0.8,
        durationSec: 120,
        isEstimated: false,
      },
    ],
    transfers: [],
  });

  const sampleRouteResult: RouteResult = {
    mode: 'OPTIMAL',
    stationIds: ['02_222', '02_221'],
    segments: [
      {
        lineId: '02',
        direction: 'INNER',
        isExpress: false,
        fromStationId: '02_222',
        toStationId: '02_221',
        stationCount: 1,
        durationSec: 120,
        distanceKm: 0.8,
      },
    ],
    transfers: [],
    totalDurationSec: 120,
    totalDistanceKm: 0.8,
    transferCount: 0,
    totalFare: 1400,
  };

  beforeEach(async () => {
    mockEngine = {
      findRoute: jest.fn().mockImplementation((query) =>
        Promise.resolve({
          ...sampleRouteResult,
          mode: query.mode,
        }),
      ),
    };

    mockGraphService = {
      getGraph: jest.fn().mockReturnValue(testGraph),
    };

    mockCongestionProvider = {
      predictCars: jest.fn().mockReturnValue({
        ratePercent: 42,
        source: 'STATISTICS',
        cars: [
          { carNo: 1, rate: 35, level: '여유' },
          { carNo: 2, rate: 45, level: '보통' },
          { carNo: 3, rate: 40, level: '보통' },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteService,
        WalkingService,
        { provide: SUBWAY_ROUTE_ENGINE, useValue: mockEngine },
        { provide: SubwayGraphService, useValue: mockGraphService },
        {
          provide: StatisticalCongestionProvider,
          useValue: mockCongestionProvider,
        },
      ],
    }).compile();

    service = module.get<RouteService>(RouteService);
  });

  it('computes and returns all 4 route options', async () => {
    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
    });

    expect(result.options).toHaveLength(4);
    const modes = result.options.map((opt) => opt.mode);
    expect(modes).toEqual(
      expect.arrayContaining([
        'OPTIMAL',
        'COMFORTABLE',
        'PERSONAL',
        'CHEAPEST',
      ]),
    );

    const firstOption = result.options[0];
    expect(firstOption.totalDistanceKm).toBe(0.8);
    expect(firstOption.totalDurationSec).toBe(120);
    expect(firstOption.totalFare).toBe(1400);
    expect(firstOption.segments).toHaveLength(1);

    const segment = firstOption.segments[0];
    expect(segment.fromStationName).toBe('강남');
    expect(segment.toStationName).toBe('역삼');
    expect(segment.recommendedCarNo).toBe(1);
    expect(segment.congestionLevel).toBe('보통');
    expect(segment.congestionRate).toBe(42);
    expect(segment.congestionSource).toBe('STATISTICS');
    expect(segment.isWeakAirConditioned).toBe(false); // 2호선 약냉방 없음
  });

  it('marks segments predicted without published statistics as MOCK', async () => {
    mockCongestionProvider.predictCars.mockReturnValue({
      ratePercent: 30,
      source: 'MOCK',
      cars: [{ carNo: 1, rate: 30, level: '여유' }],
    });

    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
    });

    expect(result.options[0].segments[0].congestionSource).toBe('MOCK');
  });

  it('orders requested routeMode at the top of options', async () => {
    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
      routeMode: 'CHEAPEST',
    });

    expect(result.options[0].mode).toBe('CHEAPEST');
  });

  it('handles custom departureAt timestamp properly', async () => {
    const departureIso = '2026-10-06T09:00:00.000Z';
    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
      departureAt: departureIso,
    });

    // 120 seconds duration -> 09:02:00 UTC, returned in KST (+09:00) as 18:02:00
    const arrival = result.options[0].estimatedArrivalTimestamp;
    expect(arrival).toBe('2026-10-06T18:02:00.000+09:00');
    expect(new Date(arrival).toISOString()).toBe('2026-10-06T09:02:00.000Z');
  });

  it('populates recommendedDoors on segments when transferring', async () => {
    const routeWithTransfer: RouteResult = {
      mode: 'OPTIMAL',
      stationIds: ['02_222', '02_221', '03_336'],
      segments: [
        {
          lineId: '02',
          direction: 'INNER',
          isExpress: false,
          fromStationId: '02_222',
          toStationId: '02_221',
          stationCount: 1,
          durationSec: 120,
          distanceKm: 0.8,
        },
        {
          lineId: '03',
          direction: 'DOWN',
          isExpress: false,
          fromStationId: '03_336',
          toStationId: '03_336',
          stationCount: 1,
          durationSec: 150,
          distanceKm: 1.0,
        },
      ],
      transfers: [
        {
          fromStationId: '02_221',
          toStationId: '03_336',
          walkingDurationSec: 180,
          recommendedDoors: ['2-1', '4-4'],
        },
      ],
      totalDurationSec: 450,
      totalDistanceKm: 1.8,
      transferCount: 1,
      totalFare: 1400,
    };

    mockEngine.findRoute.mockResolvedValue(routeWithTransfer);

    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '03_336',
    });

    const opt = result.options[0];
    expect(opt.segments[0].recommendedDoors).toEqual(['2-1', '4-4']);
  });

  it('throws BusinessException when origin and destination are the same', async () => {
    await expect(
      service.search({
        originStationId: '02_222',
        destinationStationId: '02_222',
      }),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST_PAYLOAD',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('throws BusinessException when origin station is unknown', async () => {
    await expect(
      service.search({
        originStationId: '99_999',
        destinationStationId: '02_221',
      }),
    ).rejects.toMatchObject({
      errorCode: 'STATION_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws BusinessException when destination station is unknown', async () => {
    await expect(
      service.search({
        originStationId: '02_222',
        destinationStationId: '99_999',
      }),
    ).rejects.toMatchObject({
      errorCode: 'STATION_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  describe('Walking & Coordinate-based Routes', () => {
    it('computes multimodal route with first-mile and last-mile walking when coordinates are provided', async () => {
      // 강남역 부근 (37.4985, 127.0270) -> 양재역 부근 (37.4840, 127.0340)
      const result = await service.search({
        originLat: 37.4985,
        originLng: 127.027,
        originName: '출발지 핀',
        destinationLat: 37.484,
        destinationLng: 127.034,
        destinationName: '목적지 빌딩',
      });

      expect(result.options.length).toBeGreaterThanOrEqual(1);
      const opt = result.options[0];
      expect(opt.totalWalkDurationSec).toBeGreaterThan(0);
      expect(opt.totalWalkDistanceKm).toBeGreaterThan(0);
      expect(opt.totalCalories).toBeGreaterThan(0);
      expect(opt.totalSteps).toBeGreaterThan(0);

      // 세그먼트에 WALK 가 포함되어 있는지 검증
      const walkSegments = opt.segments.filter((s) => s.lineId === 'WALK');
      expect(walkSegments.length).toBe(2); // First-mile + Last-mile
      expect(walkSegments[0].fromStationName).toBe('출발지 핀');
      expect(walkSegments[1].toStationName).toBe('목적지 빌딩');
      expect(walkSegments.every((s) => s.congestionSource === undefined)).toBe(
        true,
      );
    });

    it('returns ONLY_WALK option when origin and destination coordinates are close (< 800m)', async () => {
      // 강남역 11번 출구 (37.4982, 127.0275) -> 강남역 1번 출구 (37.4975, 127.0280) 약 100m
      const result = await service.search({
        originLat: 37.4982,
        originLng: 127.0275,
        destinationLat: 37.4975,
        destinationLng: 127.028,
      });

      expect(result.options).toHaveLength(1);
      expect(result.options[0].mode).toBe('ONLY_WALK');
      expect(result.options[0].totalFare).toBe(0);
      expect(result.options[0].segments[0].lineId).toBe('WALK');
    });

    it('throws BusinessException when coordinates are too far from any subway station (> 2.5km)', async () => {
      // 제주도 한라산 좌표
      await expect(
        service.search({
          originLat: 33.3617,
          originLng: 126.5292,
          destinationStationId: '02_221',
        }),
      ).rejects.toMatchObject({
        errorCode: 'STATION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
