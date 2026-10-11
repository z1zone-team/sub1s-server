import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ROUTE_HIGHLIGHTS,
  RouteHighlight,
} from '../src/domain/subway/models/route-highlight';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface Option {
  mode: string;
  totalDurationSec: number;
  transferCount: number;
  totalFare: number;
  highlights: RouteHighlight[];
}

describe('Route highlights (e2e)', () => {
  let app: INestApplication;

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };
  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const search = async (body: Record<string, unknown>): Promise<Option[]> =>
    (await request(app.getHttpServer()).post('/api/v1/routes/search').send(body).expect(200))
      .body.data.options;

  // 옵션이 서로 갈리는 구간: 모드마다 소요시간, 환승 횟수, 요금이 다르다
  const diverging = { originStationId: '06_645', destinationStationId: 'SB_D13' };

  it('gives every option an array of known highlights', async () => {
    const options = await search(diverging);

    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      expect(Array.isArray(option.highlights)).toBe(true);
      for (const tag of option.highlights) expect(ROUTE_HIGHLIGHTS).toContain(tag);
    }
  });

  it('tags NO_TRANSFER exactly on the options without a transfer', async () => {
    for (const body of [diverging, { originStationId: '02_222', destinationStationId: '02_221' }]) {
      for (const option of await search(body)) {
        expect(option.highlights.includes('NO_TRANSFER')).toBe(option.transferCount === 0);
      }
    }
  });

  it('puts FASTEST, FEWEST_TRANSFERS and CHEAPEST exactly on the best options', async () => {
    const options = await search(diverging);
    const best = (pick: (o: Option) => number) => Math.min(...options.map(pick));
    const spread = (pick: (o: Option) => number) => Math.max(...options.map(pick)) - best(pick);

    expect(spread((o) => o.totalDurationSec)).toBeGreaterThanOrEqual(60);
    expect(spread((o) => o.transferCount)).toBeGreaterThanOrEqual(1);
    expect(spread((o) => o.totalFare)).toBeGreaterThanOrEqual(1);

    for (const option of options) {
      expect(option.highlights.includes('FASTEST')).toBe(option.totalDurationSec === best((o) => o.totalDurationSec));
      expect(option.highlights.includes('FEWEST_TRANSFERS')).toBe(option.transferCount === best((o) => o.transferCount));
      expect(option.highlights.includes('CHEAPEST')).toBe(option.totalFare === best((o) => o.totalFare));
    }
  });

  it('gives no comparative tag when every mode returns the same route', async () => {
    const options = await search({ originStationId: '02_222', destinationStationId: '02_221' });

    for (const option of options) expect(option.highlights).toEqual(['NO_TRANSFER']);
  });

  it('gives the direct walk option an empty array', async () => {
    const options = await search({
      originLat: 37.4979,
      originLng: 127.0276,
      destinationLat: 37.4985,
      destinationLng: 127.0281,
    });

    const walk = options.find((o) => o.mode === 'ONLY_WALK');
    if (walk) expect(walk.highlights).toEqual([]);
    for (const option of options.filter((o) => o.mode !== 'ONLY_WALK')) {
      expect(Array.isArray(option.highlights)).toBe(true);
    }
  });
});
