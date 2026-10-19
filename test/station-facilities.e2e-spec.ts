import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { StationFacilitiesFile } from '../src/domain/facility/models/station-facilities';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

describe('Station facilities (e2e)', () => {
  let app: INestApplication;

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const facilities = (read('station-facilities.json') as StationFacilitiesFile).stations;
  const stationIds = (read('stations.json') as { id: string }[]).map((s) => s.id);

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };

  beforeAll(async () => {
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
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);
  const withElevator = Object.keys(facilities).find((id) => facilities[id].elevatorDoors.length > 0 && facilities[id].exits.length > 0) as string;
  const withoutData = stationIds.find((id) => !facilities[id]) as string;

  it('has data for a good share of the stations', () => {
    expect(Object.keys(facilities).length).toBeGreaterThan(200);
    expect(withElevator).toBeDefined();
    expect(withoutData).toBeDefined();
  });

  it('returns the exits and elevator doors of a station with data, without authentication', async () => {
    const res = await get(`/api/v1/stations/${withElevator}/facilities`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.timestamp).toMatch(/\+09:00$/);
    expect(res.body.data).toMatchObject({ stationId: withElevator, available: true, hasElevator: true });
    expect(res.body.data.elevatorDoors).toEqual(facilities[withElevator].elevatorDoors);
    for (const door of res.body.data.elevatorDoors) expect(door).toMatch(/^\d+-\d+$/);
    expect(res.body.data.stairDoors).toEqual(facilities[withElevator].stairDoors);
    for (const door of res.body.data.stairDoors) expect(door).toMatch(/^\d+-\d+$/);
    expect(res.body.data.exits[0]).toEqual({
      exitNo: expect.any(String),
      facilities: expect.any(Array),
    });
  });

  it('answers 200 with available=false for a station without data', async () => {
    const res = await get(`/api/v1/stations/${withoutData}/facilities`).expect(200);

    expect(res.body.data).toMatchObject({
      stationId: withoutData,
      available: false,
      hasElevator: null,
      elevatorDoors: [],
      stairDoors: [],
      exits: [],
    });
  });

  it('returns 404 for an unknown station', async () => {
    const res = await get('/api/v1/stations/99_999/facilities').expect(404);

    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });
});
