import { RankingVisibility, User } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IFriendRepository } from '../../domain/friend/ports/IFriendRepository';
import { IUserRepository } from '../../domain/user/ports/IUserRepository';
import {
  LineMapResponseDto,
  TimelineResponseDto,
  TravelStatsResponseDto,
} from './dto';
import { TravelLogService } from './travel-log.service';
import { UserTravelService } from './user-travel.service';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const timeline: TimelineResponseDto = {
  totalDistanceKm: 5.2,
  totalLogsCount: 1,
  logs: [
    {
      id: 'log-1',
      originStationName: '강남',
      destStationName: '역삼',
      distanceKm: 5.2,
      traveledAt: '2026-11-20T08:00:00+09:00',
      lineIds: ['02'],
      isExpress: false,
      durationSec: 600,
      stationIds: ['02_222', '02_221'],
    },
  ],
};

const stats: TravelStatsResponseDto = {
  userId: TARGET,
  period: 'MONTH',
  totalDistanceKm: 5.2,
  totalTravelCount: 1,
  transferCount: 0,
  totalRideDurationSec: 600,
  mostVisitedStations: [
    { stationId: '02_222', stationName: '강남', visitCount: 1 },
  ],
  mostUsedLineId: '02',
  buckets: [{ key: '2026-11-20', distanceKm: 5.2, rideCount: 1 }],
  lineBreakdown: [{ lineId: '02', distanceKm: 5.2, rideDurationSec: 600 }],
};

const lineMap: LineMapResponseDto = {
  userId: TARGET,
  period: 'MONTH',
  lines: [
    {
      lineId: '02',
      lineName: '2호선',
      colorHex: '#00A84D',
      stations: [
        {
          stationId: '02_222',
          stationName: '강남',
          lineSeq: 1,
          lat: 37.49,
          lng: 127.02,
          visited: true,
        },
      ],
      links: [{ fromStationId: '02_222', toStationId: '02_221' }],
    },
  ],
};

function userWith(visibility: RankingVisibility): User {
  return { id: TARGET, rankingVisibility: visibility } as User;
}

describe('UserTravelService', () => {
  let travelLogService: {
    getTimeline: jest.Mock;
    aggregateTravelStats: jest.Mock;
    buildLineMap: jest.Mock;
  };
  let userRepo: { findById: jest.Mock };
  let friendRepo: { findFriend: jest.Mock };
  let service: UserTravelService;

  beforeEach(() => {
    travelLogService = {
      getTimeline: jest.fn().mockResolvedValue(timeline),
      aggregateTravelStats: jest.fn().mockResolvedValue(stats),
      buildLineMap: jest.fn().mockResolvedValue(lineMap),
    };
    userRepo = { findById: jest.fn().mockResolvedValue(userWith('PUBLIC')) };
    friendRepo = { findFriend: jest.fn().mockResolvedValue(null) };
    service = new UserTravelService(
      travelLogService as unknown as TravelLogService,
      userRepo as unknown as IUserRepository,
      friendRepo as unknown as IFriendRepository,
    );
  });

  describe('공개 범위', () => {
    it('PUBLIC 사용자는 친구가 아니어도 볼 수 있다', async () => {
      await expect(
        service.getTimeline(VIEWER, TARGET, { year: 2026, month: 11 }),
      ).resolves.toBeDefined();
      expect(travelLogService.getTimeline).toHaveBeenCalledWith(TARGET, {
        year: 2026,
        month: 11,
      });
    });

    it('ANONYMOUS 사용자는 친구만 볼 수 있다', async () => {
      userRepo.findById.mockResolvedValue(userWith('ANONYMOUS'));
      friendRepo.findFriend.mockResolvedValue({
        user: userWith('ANONYMOUS'),
        friendedAt: new Date(),
      });

      await expect(
        service.getTravelStats(VIEWER, TARGET, { period: 'MONTH' }),
      ).resolves.toBeDefined();
      expect(friendRepo.findFriend).toHaveBeenCalledWith(VIEWER, TARGET);
    });

    it('친구가 아니면 ANONYMOUS 사용자의 기록은 403', async () => {
      userRepo.findById.mockResolvedValue(userWith('ANONYMOUS'));

      await expect(
        service.getTravelStats(VIEWER, TARGET, { period: 'MONTH' }),
      ).rejects.toMatchObject({ errorCode: 'FORBIDDEN_TRAVEL_HISTORY' });
      expect(travelLogService.aggregateTravelStats).not.toHaveBeenCalled();
    });

    it('PRIVATE 사용자도 친구는 볼 수 있다', async () => {
      userRepo.findById.mockResolvedValue(userWith('PRIVATE'));
      friendRepo.findFriend.mockResolvedValue({
        user: userWith('PRIVATE'),
        friendedAt: new Date(),
      });

      await expect(
        service.getLineMap(VIEWER, TARGET, { period: 'ALL' }),
      ).resolves.toBeDefined();
    });

    it('친구가 아니면 PRIVATE 사용자의 기록은 403', async () => {
      userRepo.findById.mockResolvedValue(userWith('PRIVATE'));

      const error = await service
        .getLineMap(VIEWER, TARGET, { period: 'ALL' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getStatus()).toBe(403);
      expect(travelLogService.buildLineMap).not.toHaveBeenCalled();
    });

    it('없는 사용자는 404', async () => {
      userRepo.findById.mockResolvedValue(null);

      const error = await service
        .getTimeline(VIEWER, TARGET, { year: 2026, month: 11 })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getStatus()).toBe(404);
      expect(error).toMatchObject({ errorCode: 'USER_NOT_FOUND' });
    });

    it('본인은 PRIVATE이어도 볼 수 있다', async () => {
      userRepo.findById.mockResolvedValue({
        ...userWith('PRIVATE'),
        id: VIEWER,
      });

      await expect(
        service.getLineMap(VIEWER, VIEWER, { period: 'WEEK' }),
      ).resolves.toBeDefined();
      expect(travelLogService.buildLineMap).toHaveBeenCalledWith(
        VIEWER,
        'WEEK',
      );
    });
  });

  describe('응답', () => {
    it('타임라인은 내 기록과 같은 필드에 대상 userId를 붙인다', async () => {
      const res = await service.getTimeline(VIEWER, TARGET, {
        year: 2026,
        month: 11,
      });
      expect(res).toEqual({ userId: TARGET, ...timeline });
    });

    it('통계는 내 기록 응답과 같은 값이다', async () => {
      const res = await service.getTravelStats(VIEWER, TARGET, {
        period: 'MONTH',
      });
      expect(res).toEqual(stats);
      expect(travelLogService.aggregateTravelStats).toHaveBeenCalledWith(
        TARGET,
        'MONTH',
      );
    });

    it('노선도는 내 기록 응답과 같은 값이다', async () => {
      const res = await service.getLineMap(VIEWER, TARGET, { period: 'MONTH' });
      expect(res).toEqual(lineMap);
    });

    it('내 기록 응답에 새 필드가 생겨도 다른 사용자 응답에는 나가지 않는다', async () => {
      travelLogService.aggregateTravelStats.mockResolvedValue({
        ...stats,
        secretField: 'x',
      });
      const res = await service.getTravelStats(VIEWER, TARGET, {
        period: 'MONTH',
      });
      expect(res).not.toHaveProperty('secretField');
    });
  });
});
