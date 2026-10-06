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

describe('Route Search (e2e)', () => {
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

  it('POST /api/v1/routes/search returns route options with stations and congestion', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '02_222', // 강남
        destinationStationId: '02_221', // 역삼
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.options).toBeDefined();
    expect(res.body.data.options.length).toBeGreaterThanOrEqual(1);

    const firstOption = res.body.data.options[0];
    expect(firstOption.totalDurationSec).toBeGreaterThan(0);
    expect(firstOption.totalDistanceKm).toBeGreaterThan(0);
    expect(firstOption.totalFare).toBeGreaterThan(0);
    expect(firstOption.segments.length).toBeGreaterThan(0);

    const segment = firstOption.segments[0];
    expect(segment.lineId).toBe('02');
    expect(segment.fromStationName).toBe('강남');
    expect(segment.toStationName).toBe('역삼');
    expect(segment.recommendedCarNo).toBeGreaterThanOrEqual(1);
    expect(segment.recommendedCarNo).toBeLessThanOrEqual(10);
    expect(['여유', '보통', '혼잡']).toContain(segment.congestionLevel);
  });

  it('POST /api/v1/routes/search validates bad request (same origin/dest)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '02_222',
        destinationStationId: '02_222',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_REQUEST_PAYLOAD');
  });

  it('POST /api/v1/routes/search returns 404 for unknown station', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '99_999',
        destinationStationId: '02_221',
      })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });

  it('POST /api/v1/routes/search validates missing fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_REQUEST_PAYLOAD');
  });
});
