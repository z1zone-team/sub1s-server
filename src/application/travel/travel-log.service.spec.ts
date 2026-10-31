import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { TRACKING_REPOSITORY } from '../../domain/tracking/ports/ITrackingRepository';
import {
  DuplicateTravelLogError,
  TRAVEL_LOG_REPOSITORY,
} from '../../domain/travel/ports/ITravelLogRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { PAYLOAD_ENCRYPTOR } from '../../domain/travel/ports/IPayloadEncryptor';
import { RankingNotifier } from './ranking.notifier';
import { SubwayRouteOptionDto } from '../route/dto/route-search-response.dto';
import { RouteService } from '../route/route.service';
import { TravelLogService } from './travel-log.service';

describe('TravelLogService', () => {
  let service: TravelLogService;
  let mockTravelLogRepo: {
    saveTravelWithScores: jest.Mock;
    findByTrackingSession: jest.Mock;
    findScoreTotals: jest.Mock;
    findTimelineLogs: jest.Mock;
    findStatsLogs: jest.Mock;
    findLineMapLogs: jest.Mock;
    findRecentRouteChoices: jest.Mock;
  };
  let mockUserRepo: {
    upsertPlaceholder: jest.Mock;
  };
  let mockRouteService: { search: jest.Mock };
  let mockCryptoService: { encrypt: jest.Mock; decrypt: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
  let mockTrackingRepo: { findById: jest.Mock; delete: jest.Mock };
  let mockGateway: {
    sendScoreUpdate: jest.Mock;
    broadcastChanged: jest.Mock;
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
    operationStatus: 'UNKNOWN',
    highlights: [],
    mode: 'OPTIMAL',
    totalDurationSec: 120,
    totalDistanceKm: 1.0,
    totalFare: 1400,
    transferCount: 0,
    estimatedArrivalTimestamp: new Date().toISOString(),
    segments: [],
    stationIds: ['02_222', '02_221'],
  };

  beforeEach(async () => {
    mockTravelLogRepo = {
      saveTravelWithScores: jest.fn().mockResolvedValue({
        monthlyScore: { totalPoints: 10 },
        allScore: { totalPoints: 10 },
        createdLog: { id: 'log-123' },
      }),
      findByTrackingSession: jest.fn().mockResolvedValue(null),
      findScoreTotals: jest
        .fn()
        .mockResolvedValue({ monthlyPoints: 10, allPoints: 10 }),
      findTimelineLogs: jest.fn().mockResolvedValue([]),
      findStatsLogs: jest.fn().mockResolvedValue([]),
      findLineMapLogs: jest.fn().mockResolvedValue([]),
      findRecentRouteChoices: jest.fn().mockResolvedValue([]),
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
      delete: jest.fn().mockResolvedValue(true),
    };

    mockGateway = {
      sendScoreUpdate: jest.fn(),
      broadcastChanged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TravelLogService,
        { provide: TRAVEL_LOG_REPOSITORY, useValue: mockTravelLogRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: RouteService, useValue: mockRouteService },
        { provide: PAYLOAD_ENCRYPTOR, useValue: mockCryptoService },
        { provide: SubwayGraphService, useValue: mockGraphService },
        { provide: TRACKING_REPOSITORY, useValue: mockTrackingRepo },
        { provide: RankingNotifier, useValue: mockGateway },
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
    it('stores the stations the route passed in the encrypted payload', async () => {
      mockRouteService.search.mockResolvedValueOnce({
        options: [
          { ...mockRouteOption, stationIds: ['02_222', '02_223', '02_221'] },
        ],
      });

      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      const saved = JSON.parse(mockCryptoService.encrypt.mock.calls[0][0]);
      expect(saved.stationIds).toEqual(['02_222', '02_223', '02_221']);
    });

    it('creates travel log, encrypts payload, and atomically updates rank scores', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(Date.now() - 600000),
        routeOption: mockRouteOption,
      });
      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-points',
      });

      expect(res.logId).toBe('log-123');
      expect(res.totalDistanceKm).toBe(1.0);
      expect(res.earnedPoints).toBe(10); // 1.0 km * 10 = 10 pts
      expect(res.currentTotalPoints).toBe(10);
      expect(res.monthlyTotalPoints).toBe(10);
      expect(res.rideDurationSec).toBe(600);
      expect(res.arrivalDeltaSec).toBe(480);
      expect(mockCryptoService.encrypt).toHaveBeenCalledWith(expect.any(String), 'travel_log:user-1');
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalled();
      expect(mockUserRepo.upsertPlaceholder).toHaveBeenCalledWith('user-1');
      expect(mockGateway.sendScoreUpdate).toHaveBeenCalledWith('user-1', {
        periodKey: expect.stringMatching(/^\d{4}-\d{2}$/),
        currentPoints: 10,
      });
      expect(mockGateway.broadcastChanged).toHaveBeenCalledTimes(2);
      expect(mockGateway.broadcastChanged).toHaveBeenCalledWith({
        periodType: 'ALL',
        periodKey: 'ALL',
      });
    });

    it('persists the selected route and quantitative snapshot without recalculating', async () => {
      const selected = {
        ...mockRouteOption,
        mode: 'COMFORTABLE',
        totalDistanceKm: 2,
        totalDurationSec: 180,
        transferCount: 1,
      };
      const choiceSnapshot = {
        selected: { time: 180, walk: 120 },
        alternatives: [{ time: 120, walk: 240 }],
      };
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(Date.now() - 180000),
        routeOption: selected,
        choiceSnapshot,
      });
      const result = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'selected',
      });
      expect(mockTrackingRepo.findById).toHaveBeenCalledTimes(1);
      expect(mockRouteService.search).not.toHaveBeenCalled();
      expect(result.totalDistanceKm).toBe(2);
      expect(result.transferCount).toBe(1);
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({ choiceSnapshot, routeMode: 'COMFORTABLE' }),
      );
      expect(
        JSON.parse(mockCryptoService.encrypt.mock.calls[0][0]),
      ).toMatchObject({ durationSec: 180, routeSource: 'SELECTED' });
    });

    it('does not trust unverified client distance or transfers for ranking points', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(),
        routeOption: {
          ...mockRouteOption,
          totalDistanceKm: 100000,
          transferCount: 99,
        },
      });
      const result = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'legacy',
      });
      expect(mockRouteService.search).toHaveBeenCalledTimes(1);
      expect(result.totalDistanceKm).toBe(1);
      expect(result.transferCount).toBe(0);
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({
          choiceSnapshot: undefined,
          totalDistanceKm: 1,
        }),
      );
    });

    it('does not learn a choice from another user session', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'other',
        originStationId: '02_222',
        destStationId: '02_221',
        routeOption: mockRouteOption,
        choiceSnapshot: { selected: { time: 999 }, alternatives: [] },
      });
      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'foreign',
      });
      expect(mockRouteService.search).toHaveBeenCalledTimes(1);
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({
          choiceSnapshot: undefined,
          routeMode: undefined,
        }),
      );
    });

    it('gives only distance points even when the ride was on schedule', async () => {
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

      expect(res.earnedPoints).toBe(10);
      expect(res.rideDurationSec).toBeGreaterThanOrEqual(110);
      expect(res.rideDurationSec).toBeLessThanOrEqual(112);
      expect(res.arrivalDeltaSec).toBeGreaterThanOrEqual(-10);
      expect(res.arrivalDeltaSec).toBeLessThanOrEqual(-8);
    });

    describe('route mode history', () => {
      const session = (overrides: Record<string, unknown> = {}) => ({
        sessionId: 'sess-mode',
        userId: 'user-1',
        createdAt: new Date(Date.now() - 100 * 1000),
        routeOption: { mode: 'COMFORTABLE' },
        ...overrides,
      });
      const savedMode = () =>
        mockTravelLogRepo.saveTravelWithScores.mock.calls[0][0].routeMode;

      it('saves the route mode the user chose when starting the trip', async () => {
        mockTrackingRepo.findById.mockResolvedValueOnce(session());

        await service.createLog('user-1', {
          originStationId: '02_222',
          destStationId: '02_221',
          sessionId: 'sess-mode',
        });

        expect(savedMode()).toBe('COMFORTABLE');
      });

      it('leaves the mode empty when there is no session id', async () => {
        await service.createLog('user-1', {
          originStationId: '02_222',
          destStationId: '02_221',
        });

        expect(savedMode()).toBeUndefined();
      });

      it('leaves the mode empty when the session cannot be found', async () => {
        mockTrackingRepo.findById.mockResolvedValueOnce(null);

        await service.createLog('user-1', {
          originStationId: '02_222',
          destStationId: '02_221',
          sessionId: 'sess-missing',
        });

        expect(savedMode()).toBeUndefined();
      });

      it("does not take the mode from another user's session", async () => {
        mockTrackingRepo.findById.mockResolvedValueOnce(
          session({ userId: 'someone-else' }),
        );

        await service.createLog('user-1', {
          originStationId: '02_222',
          destStationId: '02_221',
          sessionId: 'sess-mode',
        });

        expect(savedMode()).toBeUndefined();
      });

      it('ignores a mode value the app does not know', async () => {
        mockTrackingRepo.findById.mockResolvedValueOnce(
          session({ routeOption: { mode: 'SOMETHING_ELSE' } }),
        );

        await service.createLog('user-1', {
          originStationId: '02_222',
          destStationId: '02_221',
          sessionId: 'sess-mode',
        });

        expect(savedMode()).toBeUndefined();
      });
    });

    it('reports a positive arrival delta when the ride ran late', async () => {
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

    it("does not award points from another user's session", async () => {
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

      expect(res.earnedPoints).toBe(0);
    });

    it('records a trip without a verified session but gives no points', async () => {
      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
      });

      expect(res).toMatchObject({ earnedPoints: 0 });
      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({
          earnedPoints: 0,
          trackingSessionId: undefined,
        }),
      );
    });

    it('saves the verified session id so the same trip cannot score twice', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(Date.now() - 600000),
        routeOption: mockRouteOption,
      });

      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-once',
      });

      expect(mockTravelLogRepo.saveTravelWithScores).toHaveBeenCalledWith(
        expect.objectContaining({ trackingSessionId: 'sess-once' }),
      );
    });

    it('removes the tracking session once the trip is completed', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(Date.now() - 600000),
        routeOption: mockRouteOption,
      });

      await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-done',
      });

      expect(mockTrackingRepo.delete).toHaveBeenCalledWith('sess-done');
    });

    it('returns the first result without scoring again when the session was already completed', async () => {
      mockTravelLogRepo.findByTrackingSession.mockResolvedValueOnce({
        id: 'log-first',
        totalDistanceKm: 1,
        transferCount: 0,
        earnedPoints: 30,
      });
      mockTravelLogRepo.findScoreTotals.mockResolvedValueOnce({
        monthlyPoints: 40,
        allPoints: 90,
      });

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-once',
      });

      expect(res).toMatchObject({
        logId: 'log-first',
        earnedPoints: 30,
        currentTotalPoints: 90,
        monthlyTotalPoints: 40,
      });
      expect(mockTravelLogRepo.saveTravelWithScores).not.toHaveBeenCalled();
      expect(mockGateway.broadcastChanged).not.toHaveBeenCalled();
    });

    it('returns the first result when a parallel completion saved the session first', async () => {
      mockTrackingRepo.findById.mockResolvedValueOnce({
        userId: 'user-1',
        originStationId: '02_222',
        destStationId: '02_221',
        createdAt: new Date(Date.now() - 600000),
        routeOption: mockRouteOption,
      });
      mockTravelLogRepo.findByTrackingSession
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'log-first',
          totalDistanceKm: 1,
          transferCount: 0,
          earnedPoints: 10,
        });
      mockTravelLogRepo.saveTravelWithScores.mockRejectedValueOnce(
        new DuplicateTravelLogError(),
      );

      const res = await service.createLog('user-1', {
        originStationId: '02_222',
        destStationId: '02_221',
        sessionId: 'sess-race',
      });

      expect(res.logId).toBe('log-first');
      expect(mockGateway.broadcastChanged).not.toHaveBeenCalled();
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
      expect(mockGateway.sendScoreUpdate).toHaveBeenCalledWith(
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

  describe('getRecentRouteChoices', () => {
    it('returns the recent modes newest first and drops unknown values', async () => {
      const newer = new Date('2026-10-12T09:00:00Z');
      const older = new Date('2026-10-11T09:00:00Z');
      mockTravelLogRepo.findRecentRouteChoices.mockResolvedValueOnce([
        { routeMode: 'COMFORTABLE', createdAt: newer },
        { routeMode: 'LEGACY_MODE', createdAt: older },
        { routeMode: 'OPTIMAL', createdAt: older },
      ]);

      const result = await service.getRecentRouteChoices('user-1');

      expect(result).toEqual([
        { mode: 'COMFORTABLE', createdAt: newer },
        { mode: 'OPTIMAL', createdAt: older },
      ]);
      expect(mockTravelLogRepo.findRecentRouteChoices).toHaveBeenCalledWith(
        'user-1',
        20,
      );
    });

    it('asks for the requested number of records', async () => {
      await service.getRecentRouteChoices('user-1', 5);

      expect(mockTravelLogRepo.findRecentRouteChoices).toHaveBeenCalledWith(
        'user-1',
        5,
      );
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

      const { logs } = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

      expect(logs[0].lineIds).toEqual(['09', '03']);
      expect(logs[0].isExpress).toBe(true);
      expect(logs[0].durationSec).toBe(1440 + 900 + 100);
    });

    it('returns the stations the trip passed in order', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('with-stations', '2026-10-06T10:00:00Z', 5, {
          segments: [segment('09', 5, 600, true)],
          stationIds: ['09_907', '09_915', '09_925'],
        }),
      ]);

      const { logs } = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

      expect(logs[0].stationIds).toEqual(['09_907', '09_915', '09_925']);
    });

    it('falls back to the origin and destination when the passed stations are not saved', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('old-log', '2026-10-06T10:00:00Z', 5),
        savedLog('bad-ids', '2026-10-06T11:00:00Z', 5, {
          segments: [segment('09', 5, 600)],
          stationIds: [1, 2],
        }),
      ]);

      const { logs } = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

      for (const log of logs) {
        expect(log.stationIds).toEqual(['09_907', '09_925']);
      }
    });

    it('returns traveledAt in KST (+09:00)', async () => {
      mockTravelLogRepo.findTimelineLogs.mockResolvedValueOnce([
        savedLog('t2', '2026-10-06T10:00:00Z', 1),
      ]);

      const { logs } = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

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
        savedLog('walk-only', '2026-10-06T12:00:00Z', 2, {
          segments: [segment('WALK', 2, 1500)],
        }),
      ]);

      const { logs } = await service.getTimeline('user-1', {
        year: 2026,
        month: 10,
      });

      for (const log of logs) {
        expect(log.lineIds).toEqual(['09']);
        expect(log.isExpress).toBe(false);
      }
      expect(logs.map((l) => l.durationSec)).toEqual([1100, 2200, 220]);
    });

    it('queries the KST calendar month, whatever the server time zone', async () => {
      await service.getTimeline('user-1', { year: 2026, month: 10 });
      await service.getTimeline('user-1', { year: 2026, month: 12 });

      const calls = mockTravelLogRepo.findTimelineLogs.mock.calls as [
        string,
        Date,
        Date,
      ][];
      expect(calls[0][1].toISOString()).toBe('2026-09-30T15:00:00.000Z');
      expect(calls[0][2].toISOString()).toBe('2026-10-31T15:00:00.000Z');
      expect(calls[1][1].toISOString()).toBe('2026-11-30T15:00:00.000Z');
      expect(calls[1][2].toISOString()).toBe('2026-12-31T15:00:00.000Z');
    });
  });

  describe('viewing another user', () => {
    it('refuses the stats and the line map of someone else', async () => {
      const other = '2b5f6b7e-7d0a-4f43-8a52-0c1a7f3d9e11';

      await expect(
        service.getTravelStats('user-1', { period: 'ALL', userId: other }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.getLineMap('user-1', { period: 'ALL', userId: other }),
      ).rejects.toMatchObject({ status: 403 });
      expect(mockTravelLogRepo.findStatsLogs).not.toHaveBeenCalled();
      expect(mockTravelLogRepo.findLineMapLogs).not.toHaveBeenCalled();
    });

    it('allows asking for yourself by id', async () => {
      await expect(
        service.getTravelStats('user-1', { period: 'ALL', userId: 'user-1' }),
      ).resolves.toBeDefined();
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

      const stats = await service.getTravelStats('user-empty', {
        period: 'ALL',
      });

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
        savedLog('r1', '2026-10-06T10:00:00Z', 14.6, {
          segments: [segment('09', 14.6, 1440)],
        }),
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
      expect(stats.buckets[0]).toEqual({
        key: '2026-10-05',
        distanceKm: 1.2,
        rideCount: 1,
      });
      expect(stats.buckets[5]).toEqual({
        key: '2026-10-10',
        distanceKm: 0,
        rideCount: 0,
      });
      expect(stats.buckets[6]).toEqual({
        key: '2026-10-11',
        distanceKm: 7.5,
        rideCount: 2,
      });

      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [
        string,
        Date,
      ];
      expect(startDate.toISOString()).toBe('2026-10-04T15:00:00.000Z');
    });

    it('builds one bucket per KST day of the month for MONTH', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValueOnce([
        savedLog('m1', '2026-09-30T15:30:00Z', 3),
      ]);

      const stats = await service.getTravelStats('user-1', { period: 'MONTH' });

      expect(stats.buckets).toHaveLength(31);
      expect(stats.buckets[0]).toEqual({
        key: '2026-10-01',
        distanceKm: 3,
        rideCount: 1,
      });
      expect(stats.buckets[30].key).toBe('2026-10-31');
      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [
        string,
        Date,
      ];
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
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
        '2026-11',
        '2026-12',
      ]);
      expect(stats.buckets[0]).toEqual({
        key: '2026-01',
        distanceKm: 4,
        rideCount: 1,
      });
      expect(stats.buckets[9]).toEqual({
        key: '2026-10',
        distanceKm: 6,
        rideCount: 1,
      });
      const [, startDate] = mockTravelLogRepo.findStatsLogs.mock.calls[0] as [
        string,
        Date,
      ];
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
      expect(mockTravelLogRepo.findStatsLogs).toHaveBeenCalledWith(
        'user-1',
        undefined,
      );
    });

    it('returns no buckets for ALL when there are no logs and zero-filled ones for the other periods', async () => {
      freezeNow('2026-10-11T05:00:00Z');
      mockTravelLogRepo.findStatsLogs.mockResolvedValue([]);

      expect(
        (await service.getTravelStats('user-1', { period: 'ALL' })).buckets,
      ).toEqual([]);
      const week = await service.getTravelStats('user-1', { period: 'WEEK' });
      expect(week.buckets).toHaveLength(7);
      expect(
        week.buckets.every((b) => b.distanceKm === 0 && b.rideCount === 0),
      ).toBe(true);
      expect(
        (await service.getTravelStats('user-1', { period: 'WEEK' }))
          .lineBreakdown,
      ).toEqual([]);
    });
  });

  describe('getLineMap', () => {
    it('marks the stations stored in the payload as visited, not only the endpoints', async () => {
      payloads['log-1'] = { stationIds: ['02_222', '02_221'] };
      mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
        {
          originStationId: '09_907',
          destStationId: '09_925',
          encryptedRoutePayload: 'log-1',
          iv: 'iv',
          authTag: 'tag',
          wrappedDek: 'dek',
        },
      ]);

      const res = await service.getLineMap('user-1', { period: 'ALL' });

      const stations = res.lines.find((l) => l.lineId === '02')?.stations ?? [];
      expect(stations.map((s) => s.visited)).toEqual([true, true]);
    });

    it('reads the payload with the owner of the map and logs the ones it cannot decrypt without their content', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      payloads['log-ok'] = { stationIds: ['02_222', '02_221'] };
      mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
        { originStationId: '02_222', destStationId: '02_221', encryptedRoutePayload: 'log-ok', iv: 'iv', authTag: 'tag', wrappedDek: 'dek' },
        { originStationId: '02_222', destStationId: '02_221', encryptedRoutePayload: 'unknown', iv: 'iv', authTag: 'tag', wrappedDek: 'dek' },
      ]);

      await service.getLineMap('user-1', { period: 'ALL' });

      expect(mockCryptoService.decrypt).toHaveBeenCalledWith(expect.anything(), 'travel_log:user-1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 of 2 travel logs could not be decrypted'));
      expect(warn.mock.calls.flat().join(' ')).not.toContain('unknown');
      warn.mockRestore();
    });

    describe('express segments', () => {
      const line09 = new SubwayGraph({
        stations: [15, 16, 17, 18, 19].map((seq) => ({
          id: `09_9${seq}`,
          lineId: '09',
          stationName: `s${seq}`,
          lat: 37.5,
          lng: 127 + seq / 100,
          lineSeq: seq,
        })),
        edges: [],
        transfers: [],
      });
      const visitedOf = async () => {
        const res = await service.getLineMap('user-1', { period: 'ALL' });
        const stations =
          res.lines.find((l) => l.lineId === '09')?.stations ?? [];
        return stations.map((s) => s.visited);
      };
      const log = (payload: object) => {
        payloads['log-9'] = payload;
        mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
          {
            originStationId: '09_915',
            destStationId: '09_919',
            encryptedRoutePayload: 'log-9',
            iv: 'iv',
            authTag: 'tag',
            wrappedDek: 'dek',
          },
        ]);
      };

      it('marks the stations an express train passed between its stops as visited', async () => {
        mockGraphService.getGraph.mockReturnValue(line09);
        log({
          stationIds: ['09_915', '09_917', '09_919'],
          segments: [
            {
              lineId: '09',
              isExpress: true,
              fromStationId: '09_915',
              toStationId: '09_919',
            },
          ],
        });

        expect(await visitedOf()).toEqual([true, true, true, true, true]);
      });

      it('leaves the stations between the stops of a local train alone', async () => {
        mockGraphService.getGraph.mockReturnValue(line09);
        log({
          stationIds: ['09_915', '09_919'],
          segments: [
            {
              lineId: '09',
              isExpress: false,
              fromStationId: '09_915',
              toStationId: '09_919',
            },
          ],
        });

        expect(await visitedOf()).toEqual([true, false, false, false, true]);
      });
    });

    describe('links', () => {
      // 2호선 A, B, C와 지선 D(번호는 B와 C 사이), 5호선 X, Y
      const twoLines = new SubwayGraph({
        stations: [
          {
            id: '02_A',
            lineId: '02',
            stationName: 'A',
            lat: 37.5,
            lng: 127.01,
            lineSeq: 1,
          },
          {
            id: '02_B',
            lineId: '02',
            stationName: 'B',
            lat: 37.5,
            lng: 127.02,
            lineSeq: 2,
          },
          {
            id: '02_D',
            lineId: '02',
            stationName: 'D',
            lat: 37.5,
            lng: 127.03,
            lineSeq: 3,
          },
          {
            id: '02_C',
            lineId: '02',
            stationName: 'C',
            lat: 37.5,
            lng: 127.04,
            lineSeq: 4,
          },
          {
            id: '05_X',
            lineId: '05',
            stationName: 'X',
            lat: 37.6,
            lng: 127.04,
            lineSeq: 1,
          },
          {
            id: '05_Y',
            lineId: '05',
            stationName: 'Y',
            lat: 37.6,
            lng: 127.05,
            lineSeq: 2,
          },
        ],
        edges: [],
        transfers: [],
      });
      const log = (id: string, payload: unknown) => {
        if (payload !== undefined) payloads[id] = payload;
        return {
          originStationId: '02_A',
          destStationId: '05_Y',
          encryptedRoutePayload: payload === undefined ? null : id,
          iv: payload === undefined ? null : 'iv',
          authTag: payload === undefined ? null : 'tag',
          wrappedDek: payload === undefined ? null : 'dek',
        };
      };
      const linksOf = async (lineId: string) => {
        const res = await service.getLineMap('user-1', { period: 'ALL' });
        return res.lines.find((l) => l.lineId === lineId)?.links ?? [];
      };

      it('links the stations a trip passed in order, skipping the branch station it did not pass', async () => {
        mockGraphService.getGraph.mockReturnValue(twoLines);
        mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
          log('l1', { stationIds: ['02_A', '02_B', '02_C'] }),
        ]);

        expect(await linksOf('02')).toEqual([
          { fromStationId: '02_A', toStationId: '02_B' },
          { fromStationId: '02_B', toStationId: '02_C' },
        ]);
      });

      it('leaves out the step between two lines (transfer)', async () => {
        mockGraphService.getGraph.mockReturnValue(twoLines);
        mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
          log('l2', { stationIds: ['02_B', '02_C', '05_X', '05_Y'] }),
        ]);

        expect(await linksOf('02')).toEqual([
          { fromStationId: '02_B', toStationId: '02_C' },
        ]);
        expect(await linksOf('05')).toEqual([]);
      });

      it('merges the same pair even when trips went the opposite way', async () => {
        mockGraphService.getGraph.mockReturnValue(twoLines);
        mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
          log('l3', { stationIds: ['02_A', '02_B'] }),
          log('l4', { stationIds: ['02_B', '02_A'] }),
        ]);

        expect(await linksOf('02')).toHaveLength(1);
      });

      it('has no links for a trip whose route cannot be read', async () => {
        mockGraphService.getGraph.mockReturnValue(twoLines);
        mockTravelLogRepo.findLineMapLogs.mockResolvedValueOnce([
          log('l5', undefined),
        ]);

        expect(await linksOf('02')).toEqual([]);
      });
    });

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
      expect(gangnam).toMatchObject({ lat: 37.4979, lng: 127.0276 });
    });
  });
});
