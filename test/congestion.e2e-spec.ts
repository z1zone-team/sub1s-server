import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Congestion (e2e)', () => {
  let app: INestApplication;

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => {
      const dataDir = resolve(__dirname, '../src/data/subway');
      const stations = JSON.parse(
        readFileSync(resolve(dataDir, 'stations.json'), 'utf-8'),
      );
      const edges = JSON.parse(
        readFileSync(resolve(dataDir, 'edges.json'), 'utf-8'),
      );
      const transfers = JSON.parse(
        readFileSync(resolve(dataDir, 'transfers.json'), 'utf-8'),
      );
      return { stations, edges, transfers };
    },
  };

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/congestion/train returns car congestion for Gangnam train', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/congestion/train')
      .query({
        lineId: '02',
        trainId: '2145',
        stationId: '02_222', // 강남
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.lineId).toBe('02');
    expect(res.body.data.trainId).toBe('2145');
    expect(res.body.data.stationId).toBe('02_222');
    expect(res.body.data.averageRate).toBeGreaterThanOrEqual(0);
    expect(res.body.data.cars).toHaveLength(10);

    const firstCar = res.body.data.cars[0];
    expect(firstCar.carNo).toBe(1);
    expect(firstCar.rate).toBeGreaterThanOrEqual(0);
    expect(['여유', '보통', '혼잡']).toContain(firstCar.level);
    expect(typeof firstCar.isWeakAirConditioned).toBe('boolean');
  });

  it('GET /api/v1/congestion/train returns 404 for unknown station', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/congestion/train')
      .query({
        lineId: '02',
        trainId: '2145',
        stationId: '99_999',
      })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });

  it('GET /api/v1/congestion/train validates line and station mismatch', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/congestion/train')
      .query({
        lineId: '01',
        trainId: '2145',
        stationId: '02_222', // Gangnam is line 02
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_REQUEST_PAYLOAD');
  });
});
