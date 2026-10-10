import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { StatisticalCongestionProvider } from '../../infra/congestion/statistical-congestion.provider';
import { CongestionService } from './congestion.service';

describe('CongestionService', () => {
  let service: CongestionService;
  let mockGraphService: { getGraph: jest.Mock };
  let mockCongestionProvider: { predictCars: jest.Mock };

  const testGraph = new SubwayGraph({
    stations: [
      {
        id: '01_133',
        lineId: '01',
        stationName: '서울역',
        lat: 37.5546,
        lng: 126.9706,
        lineSeq: 1,
      },
      {
        id: '02_222',
        lineId: '02',
        stationName: '강남',
        lat: 37.4979,
        lng: 127.0276,
        lineSeq: 1,
      },
    ],
    edges: [
      {
        fromStationId: '01_133',
        toStationId: '01_133',
        lineId: '01',
        direction: 'DOWN',
        isExpress: false,
        distanceKm: 1.0,
        durationSec: 120,
        isEstimated: false,
      },
    ],
    transfers: [],
  });

  beforeEach(async () => {
    mockGraphService = {
      getGraph: jest.fn().mockReturnValue(testGraph),
    };

    mockCongestionProvider = {
      predictCars: jest.fn().mockReturnValue({
        ratePercent: 50,
        source: 'STATISTICS',
        cars: [
          { carNo: 1, rate: 40, level: '보통' },
          { carNo: 2, rate: 50, level: '보통' },
          { carNo: 3, rate: 50, level: '보통' },
          { carNo: 4, rate: 60, level: '보통' },
          { carNo: 5, rate: 50, level: '보통' },
          { carNo: 6, rate: 50, level: '보통' },
          { carNo: 7, rate: 60, level: '보통' },
          { carNo: 8, rate: 50, level: '보통' },
          { carNo: 9, rate: 50, level: '보통' },
          { carNo: 10, rate: 40, level: '보통' },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CongestionService,
        { provide: SubwayGraphService, useValue: mockGraphService },
        {
          provide: StatisticalCongestionProvider,
          useValue: mockCongestionProvider,
        },
      ],
    }).compile();

    service = module.get<CongestionService>(CongestionService);
  });

  it('returns train congestion with 10 cars and weak air conditioning mapped', async () => {
    const result = await service.getTrainCongestion({
      lineId: '01',
      trainId: '1004',
      stationId: '01_133',
    });

    expect(result.lineId).toBe('01');
    expect(result.trainId).toBe('1004');
    expect(result.stationId).toBe('01_133');
    expect(result.cars).toHaveLength(10);
    expect(result.averageRate).toBe(50);

    // In line 1, car 4 and car 7 are weak air conditioned
    const car4 = result.cars.find((c) => c.carNo === 4);
    const car7 = result.cars.find((c) => c.carNo === 7);
    const car2 = result.cars.find((c) => c.carNo === 2);

    expect(car4?.isWeakAirConditioned).toBe(true);
    expect(car7?.isWeakAirConditioned).toBe(true);
    expect(car2?.isWeakAirConditioned).toBe(false);
  });

  it.each(['STATISTICS', 'MOCK'])(
    'reports %s as the congestion source of the prediction',
    async (source) => {
      mockCongestionProvider.predictCars.mockReturnValue({
        ...mockCongestionProvider.predictCars(),
        source,
      });

      const result = await service.getTrainCongestion({
        lineId: '01',
        trainId: '1004',
        stationId: '01_133',
      });

      expect(result.source).toBe(source);
    },
  );

  it('throws BusinessException when station is unknown', async () => {
    await expect(
      service.getTrainCongestion({
        lineId: '01',
        trainId: '1004',
        stationId: '99_999',
      }),
    ).rejects.toMatchObject({
      errorCode: 'STATION_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws BusinessException when station line does not match requested line', async () => {
    await expect(
      service.getTrainCongestion({
        lineId: '01',
        trainId: '1004',
        stationId: '02_222', // Gangnam is line 02, not 01
      }),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST_PAYLOAD',
      status: HttpStatus.BAD_REQUEST,
    });
  });
});
