import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { WalkingService } from '../../domain/subway/services/walking.service';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { InMemoryTrackingRepository } from '../../infra/tracking/in-memory-tracking.repository';
import { OffRouteNotifier } from './off-route.notifier';
import { SmartAlertNotifier } from './smart-alert.notifier';
import { SubwayRouteOptionDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import { TrackingService } from './tracking.service';

describe('TrackingService', () => {
  const USER_ID = 'user-1';
  const OTHER_USER_ID = 'user-2';

  let service: TrackingService;
  let mockRouteService: { search: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
  let mockGateway: { sendOffRouteAlert: jest.Mock };
  let mockSmartAlerts: { sendSmartAlert: jest.Mock };

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
        lng: 127.0365,
        lineSeq: 2,
      },
      {
        id: '02_220',
        lineId: '02',
        stationName: '선릉',
        lat: 37.5045,
        lng: 127.049,
        lineSeq: 3,
      },
      {
        id: '02_223',
        lineId: '02',
        stationName: '교대',
        lat: 37.4934,
        lng: 127.0142,
        lineSeq: 4,
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
      {
        fromStationId: '02_221',
        toStationId: '02_220',
        lineId: '02',
        direction: 'INNER',
        isExpress: false,
        distanceKm: 1.2,
        durationSec: 130,
        isEstimated: false,
      },
    ],
    transfers: [],
  });

  const mockRouteOption: SubwayRouteOptionDto = {
    operationStatus: 'UNKNOWN',
    highlights: [],
    mode: 'OPTIMAL',
    totalDurationSec: 250,
    totalDistanceKm: 2.0,
    totalFare: 1400,
    transferCount: 0,
    estimatedArrivalTimestamp: new Date().toISOString(),
    segments: [
      {
        operationStatus: 'UNKNOWN',
        lineId: '02',
        direction: 'INNER',
        isExpress: false,
        fromStationId: '02_222',
        fromStationName: '강남',
        toStationId: '02_220',
        toStationName: '선릉',
        stationCount: 2,
        durationSec: 250,
        distanceKm: 2.0,
        recommendedCarNo: 4,
        isWeakAirConditioned: false,
        congestionLevel: '보통',
        congestionRate: 45,
      },
    ],
  };

  const mockRerouteOption: SubwayRouteOptionDto = {
    operationStatus: 'UNKNOWN',
    highlights: [],
    mode: 'OPTIMAL',
    totalDurationSec: 360,
    totalDistanceKm: 3.0,
    totalFare: 1400,
    transferCount: 0,
    estimatedArrivalTimestamp: new Date().toISOString(),
    segments: [
      {
        operationStatus: 'UNKNOWN',
        lineId: '02',
        direction: 'INNER',
        isExpress: false,
        fromStationId: '02_223',
        fromStationName: '교대',
        toStationId: '02_220',
        toStationName: '선릉',
        stationCount: 3,
        durationSec: 360,
        distanceKm: 3.0,
        recommendedCarNo: 3,
        isWeakAirConditioned: false,
        congestionLevel: '보통',
        congestionRate: 50,
      },
    ],
  };

  beforeEach(async () => {
    mockRouteService = {
      search: jest.fn().mockResolvedValue({ options: [mockRerouteOption] }),
    };

    mockGraphService = {
      getGraph: jest.fn().mockReturnValue(testGraph),
    };

    mockGateway = {
      sendOffRouteAlert: jest.fn(),
    };

    mockSmartAlerts = { sendSmartAlert: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        OffRouteDetector,
        WalkingService,
        {
          provide: TRACKING_REPOSITORY,
          useClass: InMemoryTrackingRepository,
        },
        {
          provide: SubwayGraphService,
          useValue: mockGraphService,
        },
        {
          provide: RouteService,
          useValue: mockRouteService,
        },
        {
          provide: OffRouteNotifier,
          useValue: mockGateway,
        },
        {
          provide: SmartAlertNotifier,
          useValue: mockSmartAlerts,
        },
      ],
    }).compile();

    service = module.get<TrackingService>(TrackingService);
  });

  describe('startTracking', () => {
    it('creates tracking session and extracts all intermediate stations', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      expect(session.sessionId).toBeDefined();
      expect(session.currentStationId).toBe('02_222');
      expect(session.currentStationName).toBe('강남');
      expect(session.destStationId).toBe('02_220');
      expect(session.isOffRoute).toBe(false);
      expect(session.expectedRemainingStationIds).toContain('02_221');
      expect(session.expectedRemainingStationIds).toContain('02_220');
    });

    it('throws BAD_REQUEST when routeOption segments are empty', async () => {
      await expect(
        service.startTracking(USER_ID, {
          routeOption: { ...mockRouteOption, segments: [] },
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('route sent without a server issued id', () => {
    const start = (routeOption: unknown, stationIds?: string[]) =>
      service.startTracking(USER_ID, {
        routeOption: routeOption as never,
        stationIds,
      });
    const segment = (fromStationId: string, toStationId: string) => ({
      ...mockRouteOption.segments[0],
      fromStationId,
      toStationId,
    });

    it('rejects a segment with a station that is not in the graph', async () => {
      await expect(
        start({ ...mockRouteOption, segments: [segment('02_222', '99_999')] }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects segments that do not continue each other', async () => {
      await expect(
        start({
          ...mockRouteOption,
          segments: [segment('02_222', '02_221'), segment('02_223', '02_220')],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('accepts a transfer where the next segment starts at the same stop under another station id', async () => {
      const result = await start({
        ...mockRouteOption,
        segments: [segment('02_222', '02_221'), segment('02_221', '02_220')],
      });

      expect(result.sessionId).toBeDefined();
    });

    it('rejects a broken duration and malformed segments instead of failing with a server error', async () => {
      await expect(
        start({ ...mockRouteOption, totalDurationSec: -5 }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        start({ ...mockRouteOption, segments: [null] }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects station ids that do not match the segments', async () => {
      await expect(
        start(mockRouteOption, ['02_223', '02_220']),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('remaining duration', () => {
    it('shrinks with the stations that are left', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });
      expect(session.remainingDurationSec).toBe(
        mockRouteOption.totalDurationSec,
      );

      const mid = await service.reportLocation(
        USER_ID,
        session.sessionId,
        '02_221',
      );
      expect(mid.remainingDurationSec).toBe(
        Math.round(mockRouteOption.totalDurationSec / 2),
      );

      const last = await service.reportLocation(
        USER_ID,
        session.sessionId,
        '02_220',
      );
      expect(last.remainingDurationSec).toBe(0);
    });
  });

  describe('checkDeviate', () => {
    it('returns updated session when passenger is advancing on route', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      const result = await service.checkDeviate(USER_ID, {
        sessionId: session.sessionId,
        detectedStationId: '02_221',
      });

      expect('isOffRoute' in result).toBe(true);
      expect(result.isOffRoute).toBe(false);
      expect('currentStationId' in result && result.currentStationId).toBe(
        '02_221',
      );
    });

    it('returns off-route alert and recalculates reroute option within SLA when off route', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      const result = await service.checkDeviate(USER_ID, {
        sessionId: session.sessionId,
        detectedStationId: '02_223', // 교대 (wrong direction)
      });

      expect('reason' in result).toBe(true);
      if ('reason' in result) {
        expect(result.reason).toBe('WRONG_DIRECTION');
        expect(result.detectedStationId).toBe('02_223');
        expect(result.detectedStationName).toBe('교대');
        expect(result.rerouteOption).toEqual(mockRerouteOption);
        expect(mockRouteService.search).toHaveBeenCalledWith({
          originStationId: '02_223',
          destinationStationId: '02_220',
          routeMode: 'OPTIMAL',
        });
        expect(mockGateway.sendOffRouteAlert).toHaveBeenCalledWith(
          USER_ID,
          expect.any(Object),
        );
      }
    });

    it('triggers immediate reroute when isUserConfirmed is true', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      const result = await service.checkDeviate(USER_ID, {
        sessionId: session.sessionId,
        detectedStationId: '02_223',
        isUserConfirmed: true,
      });

      expect('reason' in result).toBe(true);
      if ('reason' in result) {
        expect(result.isOffRoute).toBe(true);
        expect(result.rerouteOption).toBeDefined();
      }
    });

    it('throws NOT_FOUND when session does not exist', async () => {
      await expect(
        service.checkDeviate(USER_ID, {
          sessionId: 'non-existent-session',
          detectedStationId: '02_222',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('throws NOT_FOUND when detected station does not exist in graph', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      await expect(
        service.checkDeviate(USER_ID, {
          sessionId: session.sessionId,
          detectedStationId: 'invalid_station_id',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('reportLocation and getSession', () => {
    it('updates current location and advances route', async () => {
      const session = await service.startTracking(USER_ID, {
        routeOption: mockRouteOption,
      });

      const updated = await service.reportLocation(
        USER_ID,
        session.sessionId,
        '02_221',
      );
      expect(updated.currentStationId).toBe('02_221');

      const fetched = await service.getSession(USER_ID, session.sessionId);
      expect(fetched.currentStationId).toBe('02_221');
    });
  });

  describe('smart alerts', () => {
    // 강남 -> 역삼 -> 선릉 한 구간. 역삼이 하차(선릉) 한 역 전이다
    const start = () =>
      service.startTracking(USER_ID, { routeOption: mockRouteOption });

    it('sends ALIGHT_PREPARE to the session owner one station before getting off', async () => {
      const session = await start();

      await service.reportLocation(USER_ID, session.sessionId, '02_221');

      expect(mockSmartAlerts.sendSmartAlert).toHaveBeenCalledTimes(1);
      expect(mockSmartAlerts.sendSmartAlert).toHaveBeenCalledWith(USER_ID, {
        type: 'ALIGHT_PREPARE',
        message: '다음 역 선릉역에서 내려요',
        recommendedDoor: '',
      });
    });

    it('does not send before that station', async () => {
      const session = await start();

      await service.reportLocation(USER_ID, session.sessionId, '02_222');

      expect(mockSmartAlerts.sendSmartAlert).not.toHaveBeenCalled();
    });

    it('sends each alert only once even when the same station is reported again', async () => {
      const session = await start();

      await service.reportLocation(USER_ID, session.sessionId, '02_221');
      await service.reportLocation(USER_ID, session.sessionId, '02_221');
      await service.checkDeviate(USER_ID, {
        sessionId: session.sessionId,
        detectedStationId: '02_221',
      });

      expect(mockSmartAlerts.sendSmartAlert).toHaveBeenCalledTimes(1);
    });

    it('also sends when the position comes through the deviation check', async () => {
      const session = await start();

      await service.checkDeviate(USER_ID, {
        sessionId: session.sessionId,
        detectedStationId: '02_221',
      });

      expect(mockSmartAlerts.sendSmartAlert).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ type: 'ALIGHT_PREPARE' }),
      );
    });

    it('still advances the position when sending the alert fails', async () => {
      mockSmartAlerts.sendSmartAlert.mockImplementation(() => {
        throw new Error('socket down');
      });
      const session = await start();

      const result = await service.reportLocation(
        USER_ID,
        session.sessionId,
        '02_221',
      );

      expect(result.currentStationId).toBe('02_221');
    });
  });

  describe('session ownership', () => {
    const start = () =>
      service.startTracking(USER_ID, { routeOption: mockRouteOption });

    it("reports another user's session as not found for every operation", async () => {
      const session = await start();

      await expect(
        service.getSession(OTHER_USER_ID, session.sessionId),
      ).rejects.toMatchObject({ errorCode: 'SESSION_NOT_FOUND' });
      await expect(
        service.reportLocation(OTHER_USER_ID, session.sessionId, '02_221'),
      ).rejects.toMatchObject({ errorCode: 'SESSION_NOT_FOUND' });
      await expect(
        service.checkDeviate(OTHER_USER_ID, {
          sessionId: session.sessionId,
          detectedStationId: '02_223',
        }),
      ).rejects.toMatchObject({ errorCode: 'SESSION_NOT_FOUND' });
    });

    it("does not change or alert on another user's session", async () => {
      const session = await start();

      await service
        .checkDeviate(OTHER_USER_ID, {
          sessionId: session.sessionId,
          detectedStationId: '02_223',
        })
        .catch(() => undefined);

      expect(mockGateway.sendOffRouteAlert).not.toHaveBeenCalled();
      const fetched = await service.getSession(USER_ID, session.sessionId);
      expect(fetched.isOffRoute).toBe(false);
    });

    it('lets the owner read the session', async () => {
      const session = await start();

      await expect(
        service.getSession(USER_ID, session.sessionId),
      ).resolves.toMatchObject({ sessionId: session.sessionId });
    });
  });

  describe('reportPosition', () => {
    const NEAR_YEOKSAM = { lat: 37.5007, lng: 127.0364 };
    const NEAR_GYODAE = { lat: 37.4935, lng: 127.0141 };
    const FAR_FROM_ANY_STATION = { lat: 37.62, lng: 127.2 };

    const start = () =>
      service.startTracking(USER_ID, { routeOption: mockRouteOption });

    it('advances the session when the nearest station is on the route', async () => {
      const session = await start();

      const result = await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        ...NEAR_YEOKSAM,
      });

      expect(result).toMatchObject({
        currentStationId: '02_221',
        nextStationId: '02_220',
        isOffRoute: false,
      });
    });

    it('returns the session unchanged when no station is near', async () => {
      const session = await start();

      const result = await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        ...FAR_FROM_ANY_STATION,
      });

      expect(result).toMatchObject({
        currentStationId: '02_222',
        isOffRoute: false,
      });
      expect(mockRouteService.search).not.toHaveBeenCalled();
    });

    it('does not alert on the first off-route station', async () => {
      const session = await start();

      const result = await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        ...NEAR_GYODAE,
      });

      expect(result).toMatchObject({
        currentStationId: '02_222',
        isOffRoute: false,
      });
      expect(mockGateway.sendOffRouteAlert).not.toHaveBeenCalled();
    });

    it('alerts with a reroute when an off-route station is detected twice in a row', async () => {
      const session = await start();
      const request = { sessionId: session.sessionId, ...NEAR_GYODAE };

      await service.reportPosition(USER_ID, request);
      const result = await service.reportPosition(USER_ID, request);

      expect(result).toMatchObject({
        isOffRoute: true,
        detectedStationId: '02_223',
        detectedStationName: '교대',
        rerouteOption: mockRerouteOption,
      });
      expect(mockRouteService.search).toHaveBeenCalledWith({
        originStationId: '02_223',
        destinationStationId: '02_220',
        routeMode: 'OPTIMAL',
      });
      expect(mockGateway.sendOffRouteAlert).toHaveBeenCalledTimes(1);
    });

    it('resets the off-route count when a route station is detected between', async () => {
      const session = await start();
      const off = { sessionId: session.sessionId, ...NEAR_GYODAE };

      await service.reportPosition(USER_ID, off);
      await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        ...NEAR_YEOKSAM,
      });
      const result = await service.reportPosition(USER_ID, off);

      expect(result).toMatchObject({ isOffRoute: false });
      expect(mockGateway.sendOffRouteAlert).not.toHaveBeenCalled();
    });

    it('treats an already passed route station as on route', async () => {
      const session = await start();
      await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        ...NEAR_YEOKSAM,
      });

      const result = await service.reportPosition(USER_ID, {
        sessionId: session.sessionId,
        lat: 37.4979,
        lng: 127.0276,
      });

      expect(result).toMatchObject({
        currentStationId: '02_221',
        isOffRoute: false,
      });
    });

    it('hides sessions of other users', async () => {
      const session = await start();

      await expect(
        service.reportPosition(OTHER_USER_ID, {
          sessionId: session.sessionId,
          ...NEAR_YEOKSAM,
        }),
      ).rejects.toMatchObject({ errorCode: 'SESSION_NOT_FOUND' });
    });
  });
});
