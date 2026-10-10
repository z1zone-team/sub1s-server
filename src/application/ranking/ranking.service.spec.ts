import { Test, TestingModule } from '@nestjs/testing';
import { RANK_SCORE_REPOSITORY } from '../../domain/ranking/ports/IRankScoreRepository';
import { RankingService } from './ranking.service';

describe('RankingService', () => {
  let service: RankingService;
  let mockRankScoreRepo: {
    findLeaderboard: jest.Mock;
  };

  beforeEach(async () => {
    mockRankScoreRepo = {
      findLeaderboard: jest.fn().mockResolvedValue([
        {
          userId: 'user-top',
          totalPoints: 500,
          totalDistanceKm: 45.2,
          user: { nickname: '1등유저', profileImageUrl: null },
        },
        {
          userId: 'user-me',
          totalPoints: 300,
          totalDistanceKm: 28.0,
          user: { nickname: '나', profileImageUrl: null },
        },
        {
          userId: 'user-3rd',
          totalPoints: 100,
          totalDistanceKm: 9.5,
          user: { nickname: '3등유저', profileImageUrl: null },
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        { provide: RANK_SCORE_REPOSITORY, useValue: mockRankScoreRepo },
      ],
    }).compile();

    service = module.get<RankingService>(RankingService);
  });

  it('computes 1-based ranks and correctly identifies myRank and myPoints', async () => {
    const res = await service.getRanking('user-me', {
      periodType: 'MONTHLY',
      periodKey: '2026-10',
      page: 1,
      limit: 10,
    });

    expect(res.periodType).toBe('MONTHLY');
    expect(res.periodKey).toBe('2026-10');
    expect(res.myRank).toBe(2);
    expect(res.myPoints).toBe(300);
    expect(res.leaderboard).toHaveLength(3);
    expect(res.leaderboard[0].rank).toBe(1);
    expect(res.leaderboard[0].nickname).toBe('1등유저');
    expect(res.leaderboard[1].rank).toBe(2);
    expect(res.leaderboard[1].nickname).toBe('나');
  });

  it('supports pagination with page and limit', async () => {
    const res = await service.getRanking('user-me', {
      periodType: 'MONTHLY',
      periodKey: '2026-10',
      page: 2,
      limit: 2,
    });

    expect(res.leaderboard).toHaveLength(1); // 3 total items, page 2 with limit 2 -> item 3
    expect(res.leaderboard[0].rank).toBe(3);
  });

  describe('totalUsers and myPercentile', () => {
    const rankOf = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        userId: `user-${i + 1}`,
        totalPoints: 1000 - i,
        totalDistanceKm: 10,
        user: { nickname: `u${i + 1}`, profileImageUrl: null },
      }));
    const query = { periodType: 'MONTHLY' as const, periodKey: '2026-10' };

    it('counts the users with a score in the period and rounds the percentile up', async () => {
      // user-me is 2nd of 3: 2/3 = 66.7% -> top 67%
      const res = await service.getRanking('user-me', query);

      expect(res.totalUsers).toBe(3);
      expect(res.myPercentile).toBe(67);
    });

    it('does not let floating point push an exact percentile up', async () => {
      mockRankScoreRepo.findLeaderboard.mockResolvedValueOnce(rankOf(100));

      const res = await service.getRanking('user-12', query);

      expect(res.myRank).toBe(12);
      expect(res.myPercentile).toBe(12);
    });

    it('is top 100% for the last place and top 1% for first of many', async () => {
      mockRankScoreRepo.findLeaderboard.mockResolvedValue(rankOf(2481));

      expect((await service.getRanking('user-2481', query)).myPercentile).toBe(100);
      expect((await service.getRanking('user-1', query)).myPercentile).toBe(1);
    });

    it('omits the percentile when the user has no score in the period', async () => {
      const res = await service.getRanking('user-without-score', query);

      expect(res.myRank).toBe(0);
      expect(res.totalUsers).toBe(3);
      expect(res.myPercentile).toBeUndefined();
    });

    it('reports zero users for an empty period without dividing by zero', async () => {
      mockRankScoreRepo.findLeaderboard.mockResolvedValueOnce([]);

      const res = await service.getRanking('user-me', query);

      expect(res.totalUsers).toBe(0);
      expect(res.myPercentile).toBeUndefined();
    });

    it('counts all users even when the page shows only some of them', async () => {
      const res = await service.getRanking('user-me', { ...query, page: 1, limit: 1 });

      expect(res.leaderboard).toHaveLength(1);
      expect(res.totalUsers).toBe(3);
    });
  });
});
