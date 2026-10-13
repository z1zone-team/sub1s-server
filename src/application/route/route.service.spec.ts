import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RouteResult } from '../../domain/subway/models/route';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import {
  ISubwayRouteEngine,
  SUBWAY_ROUTE_ENGINE,
} from '../../domain/subway/ports/ISubwayRouteEngine';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { WalkingService } from '../../domain/subway/services/walking.service';
import { CAR_CONGESTION_PREDICTOR } from '../../domain/congestion/ports/ICarCongestionPredictor';
import { OperationStatusService } from './operation-status.service';
import { RouteService } from './route.service';

describe('RouteService', () => {
  let service: RouteService;
  let mockEngine: jest.Mocked<ISubwayRouteEngine>;
  let mockGraphService: { getGraph: jest.Mock };
  let mockCongestionProvider: { predictCars: jest.Mock };
  let mockUserRepo: { findPreferences: jest.Mock };
  let mockTravelLogRepo: { findRecentRouteChoices: jest.Mock };

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

    mockUserRepo = {
      findPreferences: jest
        .fn()
        .mockResolvedValue({ purposes: [], routePrefs: [] }),
    };
    mockTravelLogRepo = {
      findRecentRouteChoices: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteService,
        WalkingService,
        { provide: SUBWAY_ROUTE_ENGINE, useValue: mockEngine },
        { provide: OperationStatusService, useValue: { annotate: jest.fn().mockResolvedValue(undefined) } },
        { provide: SubwayGraphService, useValue: mockGraphService },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: TRAVEL_LOG_REPOSITORY, useValue: mockTravelLogRepo },
        {
          provide: CAR_CONGESTION_PREDICTOR,
          useValue: mockCongestionProvider,
        },
      ],
    }).compile();

    service = module.get<RouteService>(RouteService);
  });

  it('computes and returns all 4 route options for a signed-in user', async () => {
    const result = await service.search(
      {
        originStationId: '02_222',
        destinationStationId: '02_221',
      },
      'user-1',
    );

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

  describe('highlights', () => {
    const ride = (lineId: string, durationSec: number, direction: 'UP' | 'DOWN' = 'UP') => ({
      lineId,
      direction,
      isExpress: false,
      fromStationId: '02_222',
      toStationId: '02_221',
      stationCount: 1,
      durationSec,
      distanceKm: 1,
    });
    const result = (mode: string, over: Partial<RouteResult>): RouteResult => ({
      ...sampleRouteResult,
      mode: mode as RouteResult['mode'],
      ...over,
    });
    const search = () =>
      service.search({ originStationId: '02_222', destinationStationId: '02_221' });
    const byMode = (options: { mode: string; highlights: string[] }[], mode: string) =>
      options.find((option) => option.mode === mode)?.highlights;

    it('tags the options by comparing them with each other', async () => {
      mockEngine.findRoute.mockImplementation(async (query) =>
        query.mode === 'OPTIMAL'
          ? result('OPTIMAL', { segments: [ride('02', 1200)], totalDurationSec: 1200, transferCount: 2, totalFare: 1600 })
          : result(query.mode, { segments: [ride('02', 1800)], totalDurationSec: 1800, transferCount: 1, totalFare: 1600 }),
      );

      const { options } = await search();

      expect(byMode(options, 'OPTIMAL')).toEqual(['FASTEST']);
      expect(byMode(options, 'COMFORTABLE')).toEqual(['FEWEST_TRANSFERS']);
    });

    it('tags NO_TRANSFER on a route without transfers', async () => {
      const { options } = await search();

      for (const option of options) expect(option.highlights).toEqual(['NO_TRANSFER']);
    });

    it('counts the walk between lines as walking time', async () => {
      mockEngine.findRoute.mockImplementation(async (query) =>
        query.mode === 'OPTIMAL'
          ? result('OPTIMAL', {
              segments: [ride('02', 600)],
              transfers: [],
              totalDurationSec: 600,
              transferCount: 1,
            })
          : result(query.mode, {
              segments: [ride('02', 600)],
              transfers: [],
              totalDurationSec: 900,
              transferCount: 1,
            }),
      );

      const { options } = await search();

      expect(byMode(options, 'OPTIMAL')).toEqual(['FASTEST', 'LEAST_WALK']);
      expect(byMode(options, 'COMFORTABLE')).toEqual([]);
    });

    it('tags WEAK_AC_CAR when most of the ride is on lines with weak air-conditioned cars', async () => {
      mockEngine.findRoute.mockImplementation(async (query) =>
        query.mode === 'OPTIMAL'
          ? result('OPTIMAL', { segments: [ride('03', 700), ride('02', 300)], transferCount: 1 })
          : result(query.mode, { segments: [ride('02', 700), ride('03', 300)], transferCount: 1 }),
      );

      const { options } = await search();

      expect(byMode(options, 'OPTIMAL')).toContain('WEAK_AC_CAR');
      expect(byMode(options, 'COMFORTABLE')).not.toContain('WEAK_AC_CAR');
    });

    it('does not compare or tag the direct walk option', async () => {
      const { options } = await service.search({
        originLat: 37.4979,
        originLng: 127.0276,
        destinationLat: 37.4985,
        destinationLng: 127.0281,
      });

      const walk = options.find((option) => option.mode === 'ONLY_WALK');
      expect(walk?.highlights).toEqual([]);
    });
  });

  describe('cars', () => {
    const search = () =>
      service.search({ originStationId: '02_222', destinationStationId: '02_221' });

    it('lists the predicted congestion of every car on a ride segment, with the rate rounded', async () => {
      mockCongestionProvider.predictCars.mockReturnValue({
        ratePercent: 42,
        source: 'STATISTICS',
        cars: [
          { carNo: 1, rate: 35.4, level: '보통' },
          { carNo: 2, rate: 20.6, level: '여유' },
          { carNo: 3, rate: 80, level: '혼잡' },
        ],
      });

      const { options } = await search();

      expect(options[0].segments[0].cars).toEqual([
        { carNo: 1, rate: 35, level: '보통', isWeakAirConditioned: false },
        { carNo: 2, rate: 21, level: '여유', isWeakAirConditioned: false },
        { carNo: 3, rate: 80, level: '혼잡', isWeakAirConditioned: false },
      ]);
    });

    it('recommends the car with the lowest rate among the listed cars', async () => {
      mockCongestionProvider.predictCars.mockReturnValue({
        ratePercent: 50,
        source: 'STATISTICS',
        cars: [
          { carNo: 1, rate: 50, level: '보통' },
          { carNo: 2, rate: 30, level: '여유' },
          { carNo: 3, rate: 30, level: '여유' },
        ],
      });

      const [segment] = (await search()).options[0].segments;

      expect(segment.recommendedCarNo).toBe(2);
      const lowest = Math.min(...(segment.cars ?? []).map((car) => car.rate));
      expect(segment.cars?.find((car) => car.carNo === segment.recommendedCarNo)?.rate).toBe(lowest);
    });

    it('passes the number of cars of the line to the congestion provider', async () => {
      mockEngine.findRoute.mockImplementation(async (query) => ({
        ...sampleRouteResult,
        mode: query.mode,
        segments: [{ ...sampleRouteResult.segments[0], lineId: '09' }],
      }));

      await search();

      // 9호선은 6칸이다. 칸 수는 여섯 번째 인자다
      expect(mockCongestionProvider.predictCars.mock.calls[0][5]).toBe(6);
    });

    it('predicts no cars and recommends none on a line whose car count is unknown', async () => {
      mockEngine.findRoute.mockImplementation(async (query) => ({
        ...sampleRouteResult,
        mode: query.mode,
        segments: [{ ...sampleRouteResult.segments[0], lineId: 'GJ' }],
      }));
      mockCongestionProvider.predictCars.mockImplementation(
        (...args: unknown[]) => ({
          ratePercent: 42,
          source: 'STATISTICS',
          cars:
            args[5] === null
              ? []
              : [{ carNo: 1, rate: 35, level: '여유' }],
        }),
      );

      const [segment] = (await search()).options[0].segments;

      expect(mockCongestionProvider.predictCars.mock.calls[0][5]).toBeNull();
      expect(segment.cars).toEqual([]);
      expect(segment.recommendedCarNo).toBe(0);
      expect(segment.isWeakAirConditioned).toBe(false);
      // 칸을 모르는 노선도 구간 혼잡도는 낸다
      expect(segment.congestionRate).toBe(42);
    });

    it('marks the weak air-conditioned cars of lines that have them', async () => {
      mockEngine.findRoute.mockImplementation(async (query) => ({
        ...sampleRouteResult,
        mode: query.mode,
        segments: [{ ...sampleRouteResult.segments[0], lineId: '03' }],
      }));
      mockCongestionProvider.predictCars.mockReturnValue({
        ratePercent: 40,
        source: 'STATISTICS',
        cars: [4, 5, 7].map((carNo) => ({ carNo, rate: 40, level: '보통' })),
      });

      const [segment] = (await search()).options[0].segments;

      expect(segment.cars?.map((car) => [car.carNo, car.isWeakAirConditioned])).toEqual([
        [4, true],
        [5, false],
        [7, true],
      ]);
    });

    it('gives no cars to a walking segment', async () => {
      const { options } = await service.search({
        originLat: 37.4979,
        originLng: 127.0276,
        destinationStationId: '02_221',
      });

      const walk = options.flatMap((option) => option.segments).find((s) => s.lineId === 'WALK');
      expect(walk).toBeDefined();
      expect(walk?.cars).toBeUndefined();
    });
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

    // 120초 소요: UTC 09:02:00을 KST 18:02:00으로 반환
    const arrival = result.options[0].estimatedArrivalTimestamp;
    expect(arrival).toBe('2026-10-06T18:02:00.000+09:00');
    expect(new Date(arrival).toISOString()).toBe('2026-10-06T09:02:00.000Z');
  });

  it('reads a departureAt without an offset as KST, not as the server time zone', async () => {
    const result = await service.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
      departureAt: '2026-10-06T18:00:00',
    });

    expect(result.options[0].estimatedArrivalTimestamp).toBe(
      '2026-10-06T18:02:00.000+09:00',
    );
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

  describe('personalized recommendation', () => {
    const request = {
      originStationId: '02_222',
      destinationStationId: '02_221',
      // 평일 낮 공강 시간(혼잡 시간대 가중이 붙지 않는다)
      departureAt: '2026-10-12T13:00:00+09:00',
    };
    const personalCall = () =>
      mockEngine.findRoute.mock.calls
        .map(([query]) => query)
        .find((query) => query.mode === 'PERSONAL');

    it('does not offer the recommended route to a user who is not signed in', async () => {
      const result = await service.search(request);

      expect(result.options.map((option) => option.mode).sort()).toEqual(
        ['CHEAPEST', 'COMFORTABLE', 'OPTIMAL'],
      );
      expect(result.recommendation).toBeUndefined();
      expect(personalCall()).toBeUndefined();
      expect(mockUserRepo.findPreferences).not.toHaveBeenCalled();
    });

    it('keeps the fixed weights when a signed-in user has no signals', async () => {
      const result = await service.search(request, 'user-1');

      expect(personalCall()?.weights).toEqual({
        congestion: 1.5,
        transferSec: 240,
      });
      expect(result.recommendation).toEqual({
        context: 'WEEKDAY_MIDDAY',
        reasons: [],
        usedHistory: false,
        fareSensitive: false,
        weights: { congestion: 1.5, transferSec: 240 },
      });
    });

    it("builds the weights from the user's survey answers", async () => {
      mockUserRepo.findPreferences.mockResolvedValueOnce({
        purposes: [],
        routePrefs: ['UNCROWDED', 'FEW_TRANSFERS'],
      });

      const result = await service.search(request, 'user-1');

      expect(personalCall()?.weights).toEqual({
        congestion: 2.5,
        transferSec: 420,
      });
      expect(result.recommendation?.reasons).toEqual([
        'PREF_FEW_TRANSFERS',
        'PREF_UNCROWDED',
      ]);
    });

    it('leans on the departure time: a rush hour ride avoids crowds more', async () => {
      await service.search(
        { ...request, departureAt: '2026-10-12T08:00:00+09:00' },
        'user-1',
      );

      expect(personalCall()?.weights).toEqual({
        congestion: 2,
        transferSec: 300,
      });
    });

    it('uses the modes the user chose before', async () => {
      const at = new Date('2026-10-05T04:10:00Z'); // 한국 월요일 13:10
      mockTravelLogRepo.findRecentRouteChoices.mockResolvedValueOnce(
        Array.from({ length: 3 }, () => ({
          routeMode: 'COMFORTABLE',
          createdAt: at,
        })),
      );

      const result = await service.search(request, 'user-1');

      expect(personalCall()?.weights?.congestion).toBe(2);
      expect(result.recommendation?.usedHistory).toBe(true);
      expect(result.recommendation?.reasons).toEqual(['HISTORY_COMFORT']);
    });

    it('ignores stored modes it does not know', async () => {
      mockTravelLogRepo.findRecentRouteChoices.mockResolvedValueOnce(
        Array.from({ length: 5 }, () => ({
          routeMode: 'LEGACY',
          createdAt: new Date('2026-10-05T04:10:00Z'),
        })),
      );

      const result = await service.search(request, 'user-1');

      expect(result.recommendation?.reasons).toEqual([]);
    });

    it('still searches with the default weights when the user data cannot be read', async () => {
      mockUserRepo.findPreferences.mockRejectedValueOnce(new Error('db down'));

      const result = await service.search(request, 'user-1');

      expect(result.options).toHaveLength(4);
      expect(personalCall()?.weights).toEqual({
        congestion: 1.5,
        transferSec: 240,
      });
      expect(result.recommendation?.reasons).toEqual([]);
    });
  });
});
