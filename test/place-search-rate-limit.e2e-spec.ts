import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

describe('Place search rate limit (e2e)', () => {
  let app: INestApplication;
  const previous = process.env.PLACE_SEARCH_PER_MINUTE;

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };

  beforeAll(async () => {
    process.env.PLACE_SEARCH_PER_MINUTE = '3';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
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
    if (previous === undefined) delete process.env.PLACE_SEARCH_PER_MINUTE;
    else process.env.PLACE_SEARCH_PER_MINUTE = previous;
  });

  const search = (ip: string, token?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/places/search?q=강남').set('X-Real-IP', ip);
    return token ? req.set('Authorization', token) : req;
  };

  it('answers 429 with Retry-After once a client IP passes the limit', async () => {
    for (let i = 0; i < 3; i += 1) await search('10.1.1.1').expect(200);

    const res = await search('10.1.1.1').expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.body.error.details).toEqual({ retryAfterSec: expect.any(Number) });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('keeps serving other clients', async () => {
    await search('10.2.2.2').expect(200);
  });

  it('is not bypassed by sending an Authorization header', async () => {
    for (let i = 0; i < 3; i += 1) await search('10.3.3.3', 'Bearer x').expect(200);

    await search('10.3.3.3', 'Bearer x').expect(429);
  });

  it('does not limit the other public endpoints', async () => {
    for (let i = 0; i < 6; i += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/stations/02_222/facilities')
        .set('X-Real-IP', '10.1.1.1')
        .expect(200);
    }
  });
});
