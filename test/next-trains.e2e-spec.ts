import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  INextTrainProvider,
  NEXT_TRAIN_PROVIDER,
  NextTrain,
} from '../src/domain/arrival/ports/INextTrainProvider';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

describe('Next trains (e2e)', () => {
  let app: INestApplication;
  const fetchNextTrains = jest.fn();

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

  const train = (over: Partial<NextTrain> = {}): NextTrain => ({
    direction: 'UP',
    headsign: '개화',
    arrivalInSec: 120,
    message: '2분 후',
    isExpress: false,
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(NEXT_TRAIN_PROVIDER)
      .useValue({ fetchNextTrains } as INextTrainProvider)
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

  beforeEach(() => {
    fetchNextTrains.mockReset();
    fetchNextTrains.mockResolvedValue({
      source: 'REALTIME',
      status: 'OK',
      observedAt: new Date(),
      trains: [
        train({ arrivalInSec: 300 }),
        train({ arrivalInSec: 60 }),
        train({ direction: 'DOWN', headsign: '중앙보훈병원', arrivalInSec: 90, isExpress: true }),
        train({ arrivalInSec: 600 }),
      ],
    });
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('returns the nearest trains per direction for a station without authentication', async () => {
    const res = await get('/api/v1/stations/09_925/next-trains').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.timestamp).toMatch(/\+09:00$/);
    expect(res.body.data).toMatchObject({
      stationId: '09_925',
      lineId: '09',
      source: 'REALTIME',
      status: 'OK',
    });
    expect(res.body.data.updatedAt).toMatch(/\+09:00$/);
    expect(res.body.data.trains.map((t: NextTrain) => `${t.direction}:${t.headsign}`)).toEqual([
      'UP:개화',
      'DOWN:중앙보훈병원',
      'UP:개화',
    ]);
    expect(fetchNextTrains).toHaveBeenCalledWith({
      lineId: '09',
      stationName: res.body.data.stationName,
    });
  });

  it('honours the limit query', async () => {
    const res = await get('/api/v1/stations/09_925/next-trains?limit=1').expect(200);

    expect(res.body.data.trains).toHaveLength(2);
  });

  it('rejects a bad limit with 400', async () => {
    await get('/api/v1/stations/09_925/next-trains?limit=0').expect(400);
    await get('/api/v1/stations/09_925/next-trains?limit=6').expect(400);
    await get('/api/v1/stations/09_925/next-trains?limit=abc').expect(400);
  });

  it('answers 200 with the status when the provider has nothing', async () => {
    fetchNextTrains.mockResolvedValue({
      source: 'REALTIME',
      status: 'UNAVAILABLE',
      observedAt: new Date(),
      trains: [],
    });

    const res = await get('/api/v1/stations/09_925/next-trains').expect(200);

    expect(res.body.data).toMatchObject({ status: 'UNAVAILABLE', trains: [] });
  });

  it('returns 404 for an unknown station without calling the provider', async () => {
    const res = await get('/api/v1/stations/99_999/next-trains').expect(404);

    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
    expect(fetchNextTrains).not.toHaveBeenCalled();
  });
});
