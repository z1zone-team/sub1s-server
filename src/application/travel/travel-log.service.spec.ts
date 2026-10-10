import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { CryptoService } from '../../infra/security/crypto.service';
import { SubwayEventsGateway } from '../../infra/websocket/subway-events.gateway';
import { SubwayRouteOptionDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import { TravelLogService } from './travel-log.service';

describe('TravelLogService', () => {
  let service: TravelLogService;
  let mockTravelLogRepo: {
    saveTravelWithScores: jest.Mock;
    findTimelineLogs: jest.Mock;
    findStatsLogs: jest.Mock;
    findLineMapLogs: jest.Mock;
  };
  let mockUserRepo: {
    upsertPlaceholder: jest.Mock;
  };
  let mockRouteService: { search: jest.Mock };
  let mockCryptoService: { encrypt: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
  let mockTrackingRepo: { findById: jest.Mock };
  let mockGateway: {
    sendRankingUpdate: jest.Mock;
    broadcastRankingChanged: jest.Mock;
  };

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
    mockTravelLogRepo = {
      saveTravelWithScores: jest.fn().mockResolvedValue({
        monthlyScore: { totalPoints: 10 },
        allScore: { totalPoints: 10 },
        createdLog: { id: 'log-123' },
      }),
      findTimelineLogs: jest.fn().mockResolvedValue([]),
      findStatsLogs: jest.fn().mockResolvedValue([]),
      findLineMapLogs: jest.fn().mockResolvedValue([]),
    };

    mockUserRepo = {
      upsertPlaceholder: jest.fn().mockResolvedValue({}),
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
      sendRankingUpdate: jest.fn(),
      broadcastRankingChanged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TravelLogService,
        { provide: TRAVEL_LOG_REPOSITORY, useValue: mockTravelLogRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
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
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalled();
      expect(mockUserRepo.upsertPlaceholder).toHaveBeenCalledWith('user-1');
      // the user gets their own points; everyone else only gets an anonymous signal
      expect(mockGateway.sendRankingUpdate).toHaveBeenCalledWith('user-1', {
        periodKey: expect.stringMatching(/^\d{4}-\d{2}$/),
        currentPoints: 10,
      });
      expect(mockGateway.broadcastRankingChanged).toHaveBeenCalledTimes(2);
      expect(mockGateway.broadcastRankingChanged).toHaveBeenCalledWith({
        periodType: 'ALL',
        periodKey: 'ALL',
      });
    });

    it('awards 20 points bonus when sessionId is verified on-time', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        sessionId: 'sess-abc',
        userId: 'user-1',
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

    it("does not award the on-time bonus from another user's session", async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        sessionId: 'sess-other',
        userId: 'user-2',
        createdAt: new Date(Date.now() - 110 * 1000), // would be on time
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-other',
      });

      expect(res.earnedPoints).toBe(10);
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
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
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

  describe('getTravelStats', () => {
    it('returns aggregated stats for user logs within period', async () => {
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        {
          id: 'log-1',
          originStationId: '02_222',
          destStationId: '02_221',
          totalDistanceKm: 1.5,
          transferCount: 1,
          createdAt: new Date(),
          originStation: { stationName: '강남', lineId: '02' },
          destStation: { stationName: '역삼', lineId: '02' },
        },
        {
          id: 'log-2',
          originStationId: '02_222',
          destStationId: '02_221',
          totalDistanceKm: 2.0,
          transferCount: 0,
          createdAt: new Date(),
          originStation: { stationName: '강남', lineId: '02' },
          destStation: { stationName: '역삼', lineId: '02' },
        },
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'WEEK' });

      expect(stats.userId).toBe('user-1');
      expect(stats.period).toBe('WEEK');
      expect(stats.totalDistanceKm).toBe(3.5);
      expect(stats.totalTravelCount).toBe(2);
      expect(stats.transferCount).toBe(1);
      expect(stats.totalRideDurationSec).toBeGreaterThan(0);
      expect(stats.mostVisitedStations.length).toBe(2);
      expect(stats.mostVisitedStations[0].stationName).toBe('강남');
      expect(stats.mostVisitedStations[0].visitCount).toBe(2);
      expect(stats.mostUsedLineId).toBe('02');
    });

    it('returns zero stats when user has no travel logs', async () => {
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([]);

      const stats = await service.getTravelStats('user-empty', { period: 'ALL' });

      expect(stats.totalDistanceKm).toBe(0);
      expect(stats.totalTravelCount).toBe(0);
      expect(stats.transferCount).toBe(0);
      expect(stats.mostVisitedStations).toEqual([]);
      expect(stats.mostUsedLineId).toBeUndefined();
    });
  });

  describe('getLineMap', () => {
    it('returns subway lines with visited status for stations', async () => {
      mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
        {
          originStationId: '02_222',
          destStationId: '02_221',
          encryptedRoutePayload: null,
          iv: null,
          authTag: null,
          wrappedDek: null,
        },
      ]);

      const res = await service.getLineMap('user-1', { period: 'MONTH' });

      expect(res.userId).toBe('user-1');
      expect(res.period).toBe('MONTH');
      expect(res.lines.length).toBeGreaterThan(0);

      const line02 = res.lines.find((l) => l.lineId === '02');
      expect(line02).toBeDefined();
      expect(line02?.colorHex).toBe('#00A84D');
      expect(line02?.stations.length).toBe(2);

      const gangnam = line02?.stations.find((s) => s.stationId === '02_222');
      const yeoksam = line02?.stations.find((s) => s.stationId === '02_221');
      expect(gangnam?.visited).toBe(true);
      expect(yeoksam?.visited).toBe(true);
    });
  });
});
