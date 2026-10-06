import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { TravelLogController } from './travel-log.controller';
import { TravelLogService } from './travel-log.service';

describe('TravelLogController', () => {
  let controller: TravelLogController;
  let mockService: {
    createLog: jest.Mock;
    getTimeline: jest.Mock;
    getTravelStats?: jest.Mock;
    getLineMap?: jest.Mock;
  };

  const mockUser: AuthUser = {
    id: 'user-1',
    clerkId: 'clerk-1',
    nickname: '테스트유저',
  };

  beforeEach(async () => {
    mockService = {
      createLog: jest.fn().mockResolvedValue({
        logId: 'log-1',
        totalDistanceKm: 2.0,
        transferCount: 0,
        earnedPoints: 20,
        currentTotalPoints: 100,
      }),
      getTimeline: jest.fn().mockResolvedValue({
        totalDistanceKm: 2.0,
        totalLogsCount: 1,
        logs: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TravelLogController],
      providers: [
        {
          provide: TravelLogService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<TravelLogController>(TravelLogController);
  });

  it('POST log calls service.createLog and returns ApiResponse', async () => {
    const res = await controller.createLog(mockUser, {
      originStationId: '02_222',
      destStationId: '02_221',
    });

    expect(res.success).toBe(true);
    expect(res.data.logId).toBe('log-1');
    expect(mockService.createLog).toHaveBeenCalledWith('user-1', {
      originStationId: '02_222',
      destStationId: '02_221',
    });
  });

  it('GET timeline calls service.getTimeline and returns ApiResponse', async () => {
    const res = await controller.getTimeline(mockUser, {
      year: 2026,
      month: 10,
    });

    expect(res.success).toBe(true);
    expect(res.data.totalDistanceKm).toBe(2.0);
    expect(mockService.getTimeline).toHaveBeenCalledWith('user-1', {
      year: 2026,
      month: 10,
    });
  });

  it('GET stats calls service.getTravelStats and returns ApiResponse', async () => {
    mockService.getTravelStats = jest.fn().mockResolvedValue({
      userId: 'user-1',
      period: 'WEEK',
      totalDistanceKm: 5.5,
      totalTravelCount: 3,
      transferCount: 1,
      totalRideDurationSec: 600,
      mostVisitedStations: [],
    });

    const res = await controller.getStats(mockUser, { period: 'WEEK' });

    expect(res.success).toBe(true);
    expect(res.data.totalDistanceKm).toBe(5.5);
    expect(mockService.getTravelStats).toHaveBeenCalledWith('user-1', {
      period: 'WEEK',
    });
  });

  it('GET line-map calls service.getLineMap and returns ApiResponse', async () => {
    mockService.getLineMap = jest.fn().mockResolvedValue({
      userId: 'user-1',
      period: 'MONTH',
      lines: [],
    });

    const res = await controller.getLineMap(mockUser, { period: 'MONTH' });

    expect(res.success).toBe(true);
    expect(res.data.period).toBe('MONTH');
    expect(mockService.getLineMap).toHaveBeenCalledWith('user-1', {
      period: 'MONTH',
    });
  });
});
