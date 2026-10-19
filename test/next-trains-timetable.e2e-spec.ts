import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TrainScheduleFile } from '../src/domain/arrival/models/train-schedule';
import { HOLIDAY_CALENDAR } from '../src/domain/arrival/ports/IHolidayCalendar';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

describe('Next trains from the real timetable (e2e)', () => {
  let app: INestApplication;

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const schedule = read('next-train-schedule.json') as TrainScheduleFile;

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
      .overrideProvider(HOLIDAY_CALENDAR)
      .useValue({ isPublicHoliday: async () => false })
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

  afterEach(() => jest.restoreAllMocks());

  const atKst = (iso: string) =>
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${iso}+09:00`));
  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('ships a schedule for the weekday service of the major lines', () => {
    expect(Object.keys(schedule.dayTypes.weekday).length).toBeGreaterThan(700);
    for (const stationId of ['02_222', '09_925', '01_133']) {
      expect(schedule.dayTypes.weekday[stationId]).toBeDefined();
    }
  });

  it('answers the next trains of Sinnonhyeon on a weekday morning', async () => {
    atKst('2026-10-12T08:00:00');

    const res = await get('/api/v1/stations/09_925/next-trains?limit=3').expect(200);

    expect(res.body.data).toMatchObject({ source: 'TIMETABLE', status: 'OK', lineId: '09' });
    expect(res.body.data.updatedAt).toBe('2026-10-12T08:00:00.000+09:00');
    const directions = new Set(res.body.data.trains.map((t: { direction: string }) => t.direction));
    expect(directions).toEqual(new Set(['UP', 'DOWN']));
    for (const train of res.body.data.trains) {
      expect(train.arrivalInSec).toBeGreaterThanOrEqual(0);
      expect(train.arrivalInSec).toBeLessThanOrEqual(2 * 60 * 60);
      expect(train.message).toMatch(/^\d{2}:\d{2} 출발 예정$/);
    }
  });

  it('gives line 2 inner and outer trains', async () => {
    atKst('2026-10-12T08:00:00');

    const res = await get('/api/v1/stations/02_222/next-trains').expect(200);

    const directions = new Set(res.body.data.trains.map((t: { direction: string }) => t.direction));
    expect(directions).toEqual(new Set(['INNER', 'OUTER']));
  });

  it('has no trains but stays OK in the small hours when the first train is more than two hours away', async () => {
    atKst('2026-10-12T02:30:00');

    const res = await get('/api/v1/stations/09_925/next-trains').expect(200);

    expect(res.body.data.status).toBe('OK');
    expect(res.body.data.trains).toEqual([]);
  });

  it('still shows the late trains of the previous day just after midnight', async () => {
    atKst('2026-10-13T00:05:00');

    const res = await get('/api/v1/stations/09_925/next-trains').expect(200);

    expect(res.body.data.status).toBe('OK');
    expect(res.body.data.trains.length).toBeGreaterThan(0);
  });

  it('uses the holiday timetable on Saturday', async () => {
    atKst('2026-10-17T09:00:00');

    const res = await get('/api/v1/stations/09_925/next-trains').expect(200);

    expect(res.body.data.status).toBe('OK');
    expect(res.body.data.trains.length).toBeGreaterThan(0);
  });

  it('uses the supplemented holiday timetable for lines 2 and 7 on weekends', async () => {
    atKst('2026-10-17T09:00:00');

    const line2 = await get('/api/v1/stations/02_222/next-trains').expect(200);

    expect(line2.body.data.status).toBe('OK');
    expect(line2.body.data.trains.length).toBeGreaterThan(0);
    expect(Object.keys(schedule.dayTypes.holiday).some((id) => id.startsWith('02_'))).toBe(true);
    expect(Object.keys(schedule.dayTypes.holiday).some((id) => id.startsWith('07_'))).toBe(true);
  });

  it('is UNAVAILABLE on weekends for a station that has a weekday timetable but no holiday one', async () => {
    atKst('2026-10-17T09:00:00');

    const incheon = await get('/api/v1/stations/07_751/next-trains').expect(200);

    expect(incheon.body.data).toMatchObject({ status: 'UNAVAILABLE', trains: [] });
    expect(schedule.dayTypes.holiday['07_751']).toBeUndefined();
  });

  it('returns 404 for an unknown station', async () => {
    await get('/api/v1/stations/99_999/next-trains').expect(404);
  });
});
