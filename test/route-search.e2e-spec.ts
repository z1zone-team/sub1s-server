import { decodePolyline } from '../src/common/utils/polyline';
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
    expect(['STATISTICS', 'MOCK']).toContain(segment.congestionSource);
  });

  it('POST /api/v1/routes/search gives a ride segment the path of the real track between its stations', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originStationId: '02_222', // 강남
        destinationStationId: '02_221', // 역삼
      })
      .expect(200);

    const segment = res.body.data.options[0].segments[0];
    expect(typeof segment.path).toBe('string');
    const points = decodePolyline(segment.path);
    expect(points.length).toBeGreaterThanOrEqual(2);
    // 양 끝은 두 역의 좌표이고 사이에 선로를 따라가는 점이 있다
    expect(Math.abs(points[0].lat - 37.4979)).toBeLessThan(0.002);
    expect(Math.abs(points[points.length - 1].lat - 37.5006)).toBeLessThan(0.002);
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

  it('POST /api/v1/routes/search returns multimodal route with walking segments when coordinates provided', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originLat: 37.4985,
        originLng: 127.027,
        originName: '강남역 11번 출구 앞 카페',
        destinationStationId: '02_221', // 역삼역
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    const options = res.body.data.options;
    expect(options.length).toBeGreaterThanOrEqual(1);

    const firstOpt = options[0];
    expect(firstOpt.totalWalkDurationSec).toBeGreaterThan(0);
    expect(firstOpt.totalWalkDistanceKm).toBeGreaterThan(0);
    expect(firstOpt.totalCalories).toBeGreaterThan(0);
    expect(firstOpt.totalSteps).toBeGreaterThan(0);

    const walkSeg = firstOpt.segments.find((s: any) => s.lineId === 'WALK');
    expect(walkSeg).toBeDefined();
    expect(walkSeg.fromStationName).toBe('강남역 11번 출구 앞 카페');
  });

  it('POST /api/v1/routes/search returns ONLY_WALK when origin and destination coordinates are close (< 800m)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originLat: 37.4982,
        originLng: 127.0275,
        originName: '강남역 인근',
        destinationLat: 37.4975,
        destinationLng: 127.028,
        destinationName: '강남대로 맞은편',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    const options = res.body.data.options;
    expect(options.length).toBe(1);
    expect(options[0].mode).toBe('ONLY_WALK');
    expect(options[0].totalFare).toBe(0);
    expect(options[0].segments[0].lineId).toBe('WALK');
  });

  it('POST /api/v1/routes/search returns only a walking route when no station is within 2.5km of the coordinates', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originLat: 33.3617,
        originLng: 126.5292,
        originName: '한라산 중턱',
        destinationLat: 33.4067,
        destinationLng: 126.5292,
        destinationName: '제주시 연동',
      })
      .expect(200);

    const options = res.body.data.options;
    expect(options).toHaveLength(1);
    expect(options[0].mode).toBe('ONLY_WALK');
    expect(options[0].segments[0]).toMatchObject({
      lineId: 'WALK',
      fromStationName: '한라산 중턱',
      toStationName: '제주시 연동',
    });
  });
});
