import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

describe('RankingController', () => {
  let controller: RankingController;
  let mockService: { getRanking: jest.Mock };

  const mockUser: AuthUser = {
    id: 'user-1',
    clerkId: 'clerk-1',
    nickname: '테스트유저',
  };

  beforeEach(async () => {
    mockService = {
      getRanking: jest.fn().mockResolvedValue({
        periodType: 'MONTHLY',
        periodKey: '2026-10',
        friendsOnly: false,
        myRank: 1,
        myPoints: 100,
        leaderboard: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RankingController],
      providers: [
        {
          provide: RankingService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<RankingController>(RankingController);
  });

  it('GET / calls service.getRanking and returns ApiResponse', async () => {
    const res = await controller.getRanking(mockUser, {
      periodType: 'MONTHLY',
      periodKey: '2026-10',
    });

    expect(res.success).toBe(true);
    expect(res.data.myRank).toBe(1);
    expect(mockService.getRanking).toHaveBeenCalledWith('user-1', {
      periodType: 'MONTHLY',
      periodKey: '2026-10',
    });
  });
});
