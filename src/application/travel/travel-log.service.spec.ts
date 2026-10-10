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
  let mockCryptoService: { encrypt: jest.Mock; decrypt: jest.Mock };
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
      decrypt: jest.fn(),
      encrypt: jest.fn().mockReturnValue({
        ciphertext: 'enc-cipher',
        iv: 'iv-base64',
        tag: 'tag-base64',
        wrappedDek: 'dek-wrapped',
      }),
    };

    mockCryptoService.decrypt.mockImplementation(
      ({ ciphertext }: { ciphertext: string }) => {
        if (!(ciphertext in payloads)) throw new Error('cannot decrypt');
        return JSON.stringify(payloads[ciphertext]);
      },
    );

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


  const payloads: Record<string, unknown> = {};
  const segment = (
    lineId: string,
    distanceKm: number,
    durationSec: number,
    isExpress = false,
  ) => ({ lineId, distanceKm, durationSec, isExpress });
  const savedLog = (
    id: string,
    createdAtIso: string,
    totalDistanceKm: number,
    payload?: unknown,
    overrides: Record<string, unknown> = {},
  ) => {
    if (payload !== undefined) payloads[id] = payload;
    return {
      id,
      originStationId: '09_907',
      destStationId: '09_925',
      totalDistanceKm,
      transferCount: 0,
      createdAt: new Date(createdAtIso),
      originStation: { stationName: '가양', lineId: '09' },
      destStation: { stationName: '신논현', lineId: '09' },
      encryptedRoutePayload: payload === undefined ? null : id,
      iv: payload === undefined ? null : 'iv',
      authTag: payload === undefined ? null : 'tag',
      wrappedDek: payload === undefined ? null : 'dek',
      ...overrides,
    };
  };
  const freezeNow = (iso: string) =>
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(payloads)) delete payloads[key];
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
      expect(res.distancePoints).toBe(10);
      expect(res.onTimeBonus).toBe(0);
      expect(res.currentTotalPoints).toBe(10);
      expect(res.monthlyTotalPoints).toBe(10);
      expect(res.rideDurationSec).toBeUndefined();
      expect(res.arrivalDeltaSec).toBeUndefined();
      expect(mockCryptoService.encrypt).toHaveBeenCalled();
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalled();
      expect(mockUserRepo.upsertPlaceholder).toHaveBeenCalledWith('user-1');
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
      expect(res.distancePoints).toBe(10);
      expect(res.onTimeBonus).toBe(20);
      expect(res.rideDurationSec).toBeGreaterThanOrEqual(110);
      expect(res.rideDurationSec).toBeLessThanOrEqual(112);
      expect(res.arrivalDeltaSec).toBeGreaterThanOrEqual(-10);
      expect(res.arrivalDeltaSec).toBeLessThanOrEqual(-8);
    });

    it('reports a positive arrival delta and no bonus when the ride ran late', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        sessionId: 'sess-late',
        userId: 'user-1',
        createdAt: new Date(Date.now() - 720 * 1000),
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-late',
      });

      expect(res.onTimeBonus).toBe(0);
      expect(res.earnedPoints).toBe(10);
      expect(res.rideDurationSec).toBeGreaterThanOrEqual(720);
      expect(res.arrivalDeltaSec).toBeGreaterThanOrEqual(600);
      expect(res.arrivalDeltaSec).toBeLessThanOrEqual(602);
    });

    it('omits ride timing when the session cannot be found', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce(null);

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-missing',
      });

      expect(res.rideDurationSec).toBeUndefined();
      expect(res.arrivalDeltaSec).toBeUndefined();
      expect(res.onTimeBonus).toBe(0);
    });

    it('returns the monthly and all-time totals after the trip', async () => {
      mockTravelLogRepo.saveTravelWithScores.mockResolvedValueOnce({
        monthlyScore: { totalPoints: 2480 },
        allScore: { totalPoints: 9120 },
        createdLog: { id: 'log-456' },
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      expect(res.monthlyTotalPoints).toBe(2480);
      expect(res.currentTotalPoints).toBe(9120);
    });

    it("does not award the on-time bonus from another user's session", async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        sessionId: 'sess-other',
        userId: 'user-2',
        createdAt: new Date(Date.now() - 110 * 1000),
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-other',
      });

      expect(res.earnedPoints).toBe(10);
    });


    it('keys the ranking month by the KST calendar month, not the server month', async () => {
      freezeNow('2026-10-31T15:30:00Z');

      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({ monthlyKey: '2026-11' }),
      );
      expect(mockGateway.sendRankingUpdate).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ periodKey: '2026-11' }),
      );
    });

    it('still keys the previous month one minute before KST midnight', async () => {
      freezeNow('2026-10-31T14:59:00Z');

      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({ monthlyKey: '2026-10' }),
      );
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

    it('returns the lines, express flag and ride time from the saved route', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('t1', '2026-10-06T10:00:00Z', 14.6, {
          segments: [
            segment('WALK', 0.3, 200),
            segment('09', 14.6, 1440, true),
            segment('03', 6.9, 900),
            segment('09', 1.0, 100),
          ],
        }),
      ]);

      const { logs } = await service.getTimeline('user-1', { year: 2026, month: 10 });

      expect(logs[0].lineIds).toEqual(['09', '03']);
      expect(logs[0].isExpress).toBe(true);
      expect(logs[0].durationSec).toBe(1440 + 900 + 100);
    });

    it('returns traveledAt in KST (+09:00)', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('t2', '2026-10-06T10:00:00Z', 1),
      ]);

      const { logs } = await service.getTimeline('user-1', { year: 2026, month: 10 });

      expect(logs[0].traveledAt).toBe('2026-10-06T19:00:00.000+09:00');
    });

    it('falls back to the origin line and an estimate when the route cannot be read', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('no-payload', '2026-10-06T10:00:00Z', 10),
        savedLog('broken', '2026-10-06T11:00:00Z', 20, undefined, {
          encryptedRoutePayload: 'not-in-payloads',
          iv: 'iv',
          authTag: 'tag',
          wrappedDek: 'dek',
        }),
        savedLog('walk-only', '2026-10-06T12:00:00Z', 2, { segments: [segment('WALK', 2, 1500)] }),
      ]);

      const { logs } = await service.getTimeline('user-1', { year: 2026, month: 10 });

      for (const log of logs) {
        expect(log.lineIds).toEqual(['09']);
        expect(log.isExpress).toBe(false);
      }
      expect(logs.map((l) => l.durationSec)).toEqual([1100, 2200, 220]);
    });

    it('queries the KST calendar month, whatever the server time zone', async () => {
      await service.getTimeline('user-1', { year: 2026, month: 10 });
      await service.getTimeline('user-1', { year: 2026, month: 12 });

      const calls = mockTravelLogRepo.findTimelineLogs.mock.calls as [string, Date, Date][];
      expect(calls[0][1].toISOString()).toBe('2026-09-30T15:00:00.000Z');
      expect(calls[0][2].toISOString()).toBe('2026-10-31T15:00:00.000Z');
      expect(calls[1][1].toISOString()).toBe('2026-11-30T15:00:00.000Z');
      expect(calls[1][2].toISOString()).toBe('2026-12-31T15:00:00.000Z');
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

    it('sums the ride time and distance per line from the saved routes, longest first', async () => {
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('s1', '2026-10-06T10:00:00Z', 14.6, {
          segments: [segment('09', 14.6, 1440, true)],
        }),
        savedLog('s2', '2026-10-05T10:00:00Z', 6.9, {
          segments: [segment('WALK', 0.2, 150), segment('03', 6.9, 900)],
        }),
        savedLog('s3', '2026-10-02T10:00:00Z', 14.6, {
          segments: [segment('09', 14.6, 1500, true)],
        }),
        savedLog('unreadable', '2026-10-01T10:00:00Z', 5),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'MONTH' });

      expect(stats.lineBreakdown).toEqual([
        { lineId: '09', distanceKm: 29.2, rideDurationSec: 2940 },
        { lineId: '03', distanceKm: 6.9, rideDurationSec: 900 },
      ]);
    });

    it('uses the saved route time for the total ride time and estimates only where it is missing', async () => {
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('r1', '2026-10-06T10:00:00Z', 14.6, { segments: [segment('09', 14.6, 1440)] }),
        savedLog('r2', '2026-10-05T10:00:00Z', 10),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'MONTH' });

      expect(stats.totalRideDurationSec).toBe(1440 + 1100);
    });

    it('builds 7 daily buckets for WEEK on KST days and starts the period at KST midnight', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('w1', '2026-10-10T16:00:00Z', 5),
        savedLog('w2', '2026-10-11T02:00:00Z', 2.5),
        savedLog('w3', '2026-10-05T01:00:00Z', 1.2),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'WEEK' });

      expect(stats.buckets.map((b) => b.key)).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
      ]);
      expect(stats.buckets[0]).toEqual({ key: '2026-10-05', distanceKm: 1.2, rideCount: 1 });
      expect(stats.buckets[5]).toEqual({ key: '2026-10-10', distanceKm: 0, rideCount: 0 });
      expect(stats.buckets[6]).toEqual({ key: '2026-10-11', distanceKm: 7.5, rideCount: 2 });

      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [string, Date];
      expect(startDate.toISOString()).toBe('2026-10-04T15:00:00.000Z');
    });

    it('builds one bucket per KST day of the month for MONTH', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('m1', '2026-09-30T15:30:00Z', 3),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'MONTH' });

      expect(stats.buckets).toHaveLength(31);
      expect(stats.buckets[0]).toEqual({ key: '2026-10-01', distanceKm: 3, rideCount: 1 });
      expect(stats.buckets[30].key).toBe('2026-10-31');
      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [string, Date];
      expect(startDate.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    });

    it('builds 12 monthly buckets for YEAR and files a KST-new-year trip in January', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('y1', '2025-12-31T15:10:00Z', 4),
        savedLog('y2', '2026-10-06T10:00:00Z', 6),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'YEAR' });

      expect(stats.buckets.map((b) => b.key)).toEqual([
        '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
        '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      ]);
      expect(stats.buckets[0]).toEqual({ key: '2026-01', distanceKm: 4, rideCount: 1 });
      expect(stats.buckets[9]).toEqual({ key: '2026-10', distanceKm: 6, rideCount: 1 });
      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [string, Date];
      expect(startDate.toISOString()).toBe('2025-12-31T15:00:00.000Z');
    });

    it('builds yearly buckets from the first recorded KST year for ALL', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('a1', '2024-12-31T16:00:00Z', 2),
        savedLog('a2', '2026-05-01T00:00:00Z', 3),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'ALL' });

      expect(stats.buckets).toEqual([
        { key: '2025', distanceKm: 2, rideCount: 1 },
        { key: '2026', distanceKm: 3, rideCount: 1 },
      ]);
      expect(mockTravelLogRepo.findStatsLogs).toHaveBeenCalledWith('user-1', undefined);
    });

    it('returns no buckets for ALL when there are no logs and zero-filled ones for the other periods', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValue([]);

      expect((await service.getTravelStats('user-1', { period: 'ALL' })).buckets).toEqual([]);
      const week = await service.getTravelStats('user-1', { period: 'WEEK' });
      expect(week.buckets).toHaveLength(7);
      expect(week.buckets.every((b) => b.distanceKm === 0 && b.rideCount === 0)).toBe(true);
      expect((await service.getTravelStats('user-1', { period: 'WEEK' })).lineBreakdown).toEqual([]);
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
