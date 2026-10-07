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
});
