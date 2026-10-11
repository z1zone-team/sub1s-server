import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { OperationNotice } from '../src/domain/operation/models/operation-status';
import { OPERATION_NOTICE_PROVIDER } from '../src/domain/operation/ports/IOperationNoticeProvider';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface Segment {
  lineId: string;
  fromStationName: string;
  toStationName: string;
  operationStatus: string;
  operationNotice?: { title: string; occurredAt: string };
}
interface Option {
  mode: string;
  stationIds: string[];
  segments: Segment[];
  operationStatus: string;
  operationNotice?: { title: string; occurredAt: string };
}

describe('Operation status in route search (e2e)', () => {
  let app: INestApplication;
  let notices: OperationNotice[] | null = [];

  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const stations = read('stations.json') as { id: string; lineId: string; stationName: string }[];
  const nameOf = (id: string) => stations.find((s) => s.id === id)?.stationName ?? '';

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
      .overrideProvider(OPERATION_NOTICE_PROVIDER)
      .useValue({ fetchRecentNotices: async () => notices })
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
    notices = [];
  });

  const search = async (origin: string, destination: string): Promise<Option[]> =>
    (
      await request(app.getHttpServer())
        .post('/api/v1/routes/search')
        .send({ originStationId: origin, destinationStationId: destination })
        .expect(200)
    ).body.data.options;

  const incident = (title: string, over: Partial<OperationNotice> = {}): OperationNotice => ({
    title,
    occurredAt: Date.now() - 30 * 60_000,
    categoryCode: '4',
    lineIds: ['02'],
    ...over,
  });

  // 강남에서 역삼까지는 2호선 한 구간이다
  const GANGNAM = '02_222';
  const YEOKSAM = '02_221';

  it('is NORMAL for every ride on a covered line when there is no notice', async () => {
    const options = await search(GANGNAM, YEOKSAM);

    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.operationStatus).toBe('NORMAL');
      expect(option.segments.every((s) => s.operationStatus === 'NORMAL')).toBe(true);
    }
  });

  it('is DISRUPTED with the notice when a station on the ride is named in a current notice', async () => {
    notices = [incident('2호선 역삼역 안전문장애로 열차 무정차 통과중')];

    const options = await search(GANGNAM, YEOKSAM);

    for (const option of options) {
      expect(option.operationStatus).toBe('DISRUPTED');
      expect(option.operationNotice?.title).toBe('2호선 역삼역 안전문장애로 열차 무정차 통과중');
      expect(option.operationNotice?.occurredAt).toMatch(/\+09:00$/);
      expect(option.segments[0]).toMatchObject({ operationStatus: 'DISRUPTED' });
    }
  });

  it('turns NORMAL again once the resolution notice arrives', async () => {
    notices = [
      incident('2호선 역삼역 무정차 통과중'),
      incident('2호선 역삼역 열차 정상운행', { occurredAt: Date.now() - 5 * 60_000, categoryCode: '6' }),
    ];

    const options = await search(GANGNAM, YEOKSAM);

    expect(options.every((option) => option.operationStatus === 'NORMAL')).toBe(true);
  });

  it('ignores a notice about another line and about a station the ride does not pass', async () => {
    notices = [
      incident('1호선 열차지연', { lineIds: ['01'], categoryCode: '5' }),
      incident('2호선 이대역 무정차 통과중'),
    ];

    const options = await search(GANGNAM, YEOKSAM);

    expect(options.every((option) => option.operationStatus === 'NORMAL')).toBe(true);
  });

  it('reports DISRUPTED for the middle stations of a longer ride, not only its ends', async () => {
    const options = await search('02_224', '02_221');
    const through = options[0].stationIds.filter((id) => id !== '02_224' && id !== '02_221');
    expect(through.length).toBeGreaterThan(0);
    const middle = nameOf(through[0]);
    notices = [incident(`2호선 ${middle}역 무정차 통과중`)];

    const disrupted = await search('02_224', '02_221');

    expect(disrupted[0].operationStatus).toBe('DISRUPTED');
  });

  it('is UNKNOWN on lines whose notices are not complete, and for the whole route when mixed', async () => {
    const nineLine = stations.filter((s) => s.lineId === '09').slice(0, 2).map((s) => s.id);
    const options = await search(nineLine[0], nineLine[1]);

    for (const option of options) {
      expect(option.operationStatus).toBe('UNKNOWN');
      expect(option.segments.every((s) => s.operationStatus === 'UNKNOWN')).toBe(true);
    }
  });

  it('is UNKNOWN everywhere, but the search still works, when the notices cannot be loaded', async () => {
    notices = null;

    const options = await search(GANGNAM, YEOKSAM);

    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.operationStatus).toBe('UNKNOWN');
      expect(option.operationNotice).toBeUndefined();
    }
  });

  it('gives the direct walk option an UNKNOWN status', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({
        originLat: 37.4979,
        originLng: 127.0276,
        destinationLat: 37.4985,
        destinationLng: 127.0281,
      })
      .expect(200);

    const walk = (res.body.data.options as Option[]).find((o) => o.mode === 'ONLY_WALK');
    if (walk) expect(walk.operationStatus).toBe('UNKNOWN');
  });
});
