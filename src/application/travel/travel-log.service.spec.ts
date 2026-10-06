import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/security/crypto.service';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
import { SubwayRouteOptionDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import { TravelLogService } from './travel-log.service';

describe('TravelLogService', () => {
  let service: TravelLogService;
  let mockPrisma: {
    user: { upsert: jest.Mock };
    rankScore: { upsert: jest.Mock };
    travelLog: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockRouteService: { search: jest.Mock };
  let mockCryptoService: { encrypt: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
  let mockTrackingRepo: { findById: jest.Mock };
  let mockGateway: { broadcastRankingUpdate: jest.Mock };

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
    ],
    edges: [],
    transfers: [],
  });

  const mockRouteOption: SubwayRouteOptionDto = {
    mode: 'OPTIMAL',
    totalDurationSec: 120,
    totalDistanceKm: 1.0,
    totalFare: 1400,
    transferCount: 0,
    estimatedArrivalTimestamp: new Date().toISOString(),
    segments: [],
  };

  beforeEach(async () => {
    mockPrisma = {
      user: { upsert: jest.fn().mockResolvedValue({}) },
      rankScore: {
        upsert: jest.fn().mockResolvedValue({ totalPoints: 10 }),
      },
      travelLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-123' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((promises) => Promise.all(promises)),
    };

    mockRouteService = {
      search: jest.fn().mockResolvedValue({ options: [mockRouteOption] }),
    };

    mockCryptoService = {
      encrypt: jest.fn().mockReturnValue({
        ciphertext: 'enc-cipher',
        iv: 'iv-base64',
        tag: 'tag-base64',
        wrappedDek: 'dek-wrapped',
      }),
    };

    mockGraphService = {
      getGraph: jest.fn().mockReturnValue(testGraph),
    };

    mockTrackingRepo = {
      findById: jest.fn().mockResolvedValue(null),
    };

    mockGateway = {
      broadcastRankingUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TravelLogService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RouteService, useValue: mockRouteService },
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: SubwayGraphService, useValue: mockGraphService },
        { provide: TRACKING_REPOSITORY, useValue: mockTrackingRepo },
        { provide: SubwayEventsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<TravelLogService>(TravelLogService);
  });

  describe('createLog', () => {
    it('creates travel log, encrypts payload, and atomically updates rank scores', async () => {
      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      expect(res.logId).toBe('log-123');
      expect(res.totalDistanceKm).toBe(1.0);
      expect(res.earnedPoints).toBe(10); // 1.0 km * 10 = 10 pts
      expect(mockCryptoService.encrypt).toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockGateway.broadcastRankingUpdate).toHaveBeenCalled();
    });

    it('awards 20 points bonus when sessionId is verified on-time', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        sessionId: 'sess-abc',
        createdAt: new Date(Date.now() - 110 * 1000), // ~110 seconds ago (planned 120s)
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-abc',
      });

      // 10 distance points + 20 on-time bonus = 30 pts
      expect(res.earnedPoints).toBe(30);
    });

    it('throws NOT_FOUND when station id is unknown', async () => {
      await expect(
        service.createLog('user-1', {
          originStationId: 'unknown-station',
          destStationId: '02_221',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('getTimeline', () => {
    it('queries logs for given year and month and returns summary', async () => {
      mockPrisma.travelLog.findMany.mockResolvedValueOnce([
        {
          id: 'log-1',
          originStationId: '02_222',
          destStationId: '02_221',
          totalDistanceKm: 1.0,
          createdAt: new Date('2026-10-06T10:00:00Z'),
          originStation: { stationName: '강남' },
          destStation: { stationName: '역삼' },
        },
      ]);

      const timeline = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

      expect(timeline.totalLogsCount).toBe(1);
      expect(timeline.totalDistanceKm).toBe(1.0);
      expect(timeline.logs[0].originStationName).toBe('강남');
      expect(timeline.logs[0].destStationName).toBe('역삼');
    });
  });
});
