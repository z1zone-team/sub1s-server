import { Test, TestingModule } from '@nestjs/testing';
import { OptionalClerkAuthGuard } from '../../infra/auth/optional-clerk-auth.guard';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';
import { RouteSearchResultDto } from './dto/route-search-response.dto';

describe('RouteController', () => {
  let controller: RouteController;
  let mockService: { search: jest.Mock };

  const mockResult: RouteSearchResultDto = {
    options: [
      {
        operationStatus: 'UNKNOWN',
        highlights: [],
        mode: 'OPTIMAL',
        totalDurationSec: 180,
        totalDistanceKm: 1.2,
        totalFare: 1400,
        transferCount: 0,
        estimatedArrivalTimestamp: '2026-10-06T12:03:00.000Z',
        segments: [],
      },
    ],
  };

  beforeEach(async () => {
    mockService = {
      search: jest.fn().mockResolvedValue(mockResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouteController],
      providers: [{ provide: RouteService, useValue: mockService }],
    })
      .overrideGuard(OptionalClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RouteController>(RouteController);
  });

  it('delegates to RouteService.search and wraps in ApiResponse', async () => {
    const response = await controller.search({
      originStationId: '02_222',
      destinationStationId: '02_221',
    });

    expect(mockService.search).toHaveBeenCalledWith(
      {
        originStationId: '02_222',
        destinationStationId: '02_221',
      },
      undefined,
    );
    expect(response.success).toBe(true);
    expect(response.data).toEqual(mockResult);
    expect(response.timestamp).toBeDefined();
  });

  it('passes the signed-in user id so the recommendation can be personalized', async () => {
    await controller.search(
      { originStationId: '02_222', destinationStationId: '02_221' },
      { id: 'user-1', clerkId: 'clerk-1', nickname: '탐험가' },
    );

    expect(mockService.search).toHaveBeenCalledWith(
      { originStationId: '02_222', destinationStationId: '02_221' },
      'user-1',
    );
  });
});
