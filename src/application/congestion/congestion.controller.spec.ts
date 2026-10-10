import { Test, TestingModule } from '@nestjs/testing';
import { CongestionController } from './congestion.controller';
import { CongestionService } from './congestion.service';
import { TrainCongestionResponseDto } from './dto/train-congestion-response.dto';

describe('CongestionController', () => {
  let controller: CongestionController;
  let mockService: { getTrainCongestion: jest.Mock };

  const mockResponse: TrainCongestionResponseDto = {
    lineId: '02',
    trainId: '2145',
    stationId: '02_222',
    averageRate: 45,
    source: 'STATISTICS',
    cars: [
      {
        carNo: 1,
        rate: 45,
        level: '보통',
        isWeakAirConditioned: false,
      },
    ],
    updatedAt: '2026-10-06T12:00:00.000Z',
  };

  beforeEach(async () => {
    mockService = {
      getTrainCongestion: jest.fn().mockResolvedValue(mockResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CongestionController],
      providers: [{ provide: CongestionService, useValue: mockService }],
    }).compile();

    controller = module.get<CongestionController>(CongestionController);
  });

  it('delegates to CongestionService.getTrainCongestion and wraps in ApiResponse', async () => {
    const res = await controller.getTrainCongestion({
      lineId: '02',
      trainId: '2145',
      stationId: '02_222',
    });

    expect(mockService.getTrainCongestion).toHaveBeenCalledWith({
      lineId: '02',
      trainId: '2145',
      stationId: '02_222',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockResponse);
    expect(res.timestamp).toBeDefined();
  });
});
