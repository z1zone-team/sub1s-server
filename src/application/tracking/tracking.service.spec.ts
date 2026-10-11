import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { OffRouteDetector } from '../../domain/tracking/services/offroute-detector.service';
import { InMemoryTrackingRepository } from '../../infra/database/repositories/in-memory-tracking.repository';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        OffRouteDetector,
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
          provide: SubwayEventsGateway,
          useValue: mockGateway,
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

      const updated = await service.reportLocation(USER_ID, session.sessionId, '02_221');
      expect(updated.currentStationId).toBe('02_221');

      const fetched = await service.getSession(USER_ID, session.sessionId);
      expect(fetched.currentStationId).toBe('02_221');
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
});
