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

describe('Train positions (e2e)', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => {
      const dataDir = resolve(__dirname, '../src/data/subway');
      const read = (name: string) =>
        JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
      return {
        stations: read('stations.json'),
        edges: read('edges.json'),
        transfers: read('transfers.json'),
      };
    },
  };
  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();
    const created = moduleRef.createNestApplication();
    created.setGlobalPrefix('api');
    created.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    created.useGlobalFilters(new GlobalExceptionFilter());
    await created.init();
    return created;
  };

  afterEach(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it('serves the fake trains of the mock source for a polled line with station ids', async () => {
    process.env.TRAIN_POSITION_ENABLED = 'true';
    process.env.TRAIN_POSITION_SOURCE = 'MOCK';
    process.env.TRAIN_POSITION_LINES = '02';
    app = await build();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = await request(app.getHttpServer())
      .get('/api/v1/trains/positions?lineId=02')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ lineId: '02', source: 'MOCK', status: 'OK' });
    expect(res.body.data.trains.length).toBeGreaterThan(0);
    for (const train of res.body.data.trains) {
      expect(train.stationId).toMatch(/^02_/);
    }
  });

  it('says a line the server does not poll is unsupported', async () => {
    process.env.TRAIN_POSITION_ENABLED = 'true';
    process.env.TRAIN_POSITION_SOURCE = 'MOCK';
    process.env.TRAIN_POSITION_LINES = '02';
    app = await build();

    const other = await request(app.getHttpServer())
      .get('/api/v1/trains/positions?lineId=09')
      .expect(200);

    expect(other.body.data.status).toBe('UNSUPPORTED_LINE');
  });

  it('does not poll at all unless it is turned on', async () => {
    delete process.env.TRAIN_POSITION_ENABLED;
    process.env.TRAIN_POSITION_SOURCE = 'MOCK';
    app = await build();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const res = await request(app.getHttpServer())
      .get('/api/v1/trains/positions?lineId=02')
      .expect(200);

    expect(res.body.data.status).toBe('NOT_COLLECTED');
  });

  it('rejects a malformed line id', async () => {
    app = await build();

    await request(app.getHttpServer())
      .get('/api/v1/trains/positions?lineId=abc')
      .expect(400);
    await request(app.getHttpServer()).get('/api/v1/trains/positions').expect(400);
  });
});
