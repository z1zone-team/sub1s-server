import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../../infra/auth/current-user.decorator';
import { LineMapController } from './line-map.controller';
import { TravelLogService } from './travel-log.service';

describe('LineMapController', () => {
  let controller: LineMapController;
  let mockService: {
    getLineMap: jest.Mock;
  };

  const mockUser: AuthUser = {
    id: 'user-1',
    clerkId: 'clerk-1',
    nickname: '테스트유저',
  };

  beforeEach(async () => {
    mockService = {
      getLineMap: jest.fn().mockResolvedValue({
        userId: 'user-1',
        period: 'ALL',
        lines: [
          {
            lineId: '02',
            lineName: '2호선',
            colorHex: '#00A84D',
            stations: [],
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineMapController],
      providers: [
        {
          provide: TravelLogService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<LineMapController>(LineMapController);
  });

  it('GET /api/v1/line-map delegates to travelLogService.getLineMap', async () => {
    const res = await controller.getLineMap(mockUser, { period: 'ALL' });

    expect(res.success).toBe(true);
    expect(res.data.userId).toBe('user-1');
    expect(res.data.lines[0].lineId).toBe('02');
    expect(mockService.getLineMap).toHaveBeenCalledWith('user-1', {
      period: 'ALL',
    });
  });
});
