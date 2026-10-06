import { Test, TestingModule } from '@nestjs/testing';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TrackingSessionDto, OffRouteAlertDto } from './dto';

describe('TrackingController', () => {
  let controller: TrackingController;
  let mockTrackingService: {
    startTracking: jest.Mock;
    checkDeviate: jest.Mock;
    reportLocation: jest.Mock;
    getSession: jest.Mock;
  };

  const mockSession: TrackingSessionDto = {
    sessionId: 'sess-123',
    currentStationId: '02_222',
    currentStationName: '강남',
    nextStationId: '02_221',
    nextStationName: '역삼',
    destStationId: '02_220',
    destStationName: '선릉',
    remainingDurationSec: 250,
    isOffRoute: false,
    expectedRemainingStationIds: ['02_221', '02_220'],
  };

  const mockAlert: OffRouteAlertDto = {
    sessionId: 'sess-123',
    detectedStationId: '02_223',
    detectedStationName: '교대',
    reason: 'WRONG_DIRECTION',
    message: '경로를 이탈했습니다.',
    rerouteOption: {
      mode: 'OPTIMAL',
      totalDurationSec: 360,
      totalDistanceKm: 3.0,
      totalFare: 1400,
      transferCount: 0,
      estimatedArrivalTimestamp: new Date().toISOString(),
      segments: [],
    },
    isOffRoute: true,
  };

  beforeEach(async () => {
    mockTrackingService = {
      startTracking: jest.fn().mockResolvedValue(mockSession),
      checkDeviate: jest.fn().mockResolvedValue(mockAlert),
      reportLocation: jest.fn().mockResolvedValue(mockSession),
      getSession: jest.fn().mockResolvedValue(mockSession),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [
        {
          provide: TrackingService,
          useValue: mockTrackingService,
        },
      ],
    }).compile();

    controller = module.get<TrackingController>(TrackingController);
  });

  it('POST start returns wrapped session response', async () => {
    const res = await controller.startTracking({
      routeOption: mockAlert.rerouteOption,
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockSession);
    expect(mockTrackingService.startTracking).toHaveBeenCalled();
  });

  it('POST deviate returns wrapped deviate alert response', async () => {
    const res = await controller.checkDeviate({
      sessionId: 'sess-123',
      detectedStationId: '02_223',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockAlert);
    expect(mockTrackingService.checkDeviate).toHaveBeenCalled();
  });

  it('POST location updates location', async () => {
    const res = await controller.reportLocation({
      sessionId: 'sess-123',
      currentStationId: '02_221',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockSession);
    expect(mockTrackingService.reportLocation).toHaveBeenCalledWith(
      'sess-123',
      '02_221',
    );
  });

  it('GET :sessionId returns session', async () => {
    const res = await controller.getSession('sess-123');
    expect(res.success).toBe(true);
    expect(res.data).toEqual(mockSession);
    expect(mockTrackingService.getSession).toHaveBeenCalledWith('sess-123');
  });
});
