import { randomUUID } from 'node:crypto';
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
import { OptionalClerkAuthGuard } from '../src/infra/auth/optional-clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { STATION_FACILITY_REPOSITORY } from '../src/domain/facility/ports/IStationFacilityRepository';

// 계단 피하기(AVOID_STAIRS)를 고른 사용자의 검색에서 계단 축 자료가 있으면 반영하고, 없으면 안내하는지 본다
describe('Stairs axis in route search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const user = {
    id: randomUUID(),
    clerkId: `e2e_stairs_${tag}`,
    nickname: `stairs_${tag}`,
  };
  const dataDir = resolve(__dirname, '../src/data/subway');
  const read = (name: string) =>
    JSON.parse(readFileSync(resolve(dataDir, name), 'utf-8'));
  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => ({
      stations: read('stations.json'),
      edges: read('edges.json'),
      transfers: read('transfers.json'),
    }),
  };

  const search = (originStationId: string, destinationStationId: string) =>
    request(app.getHttpServer())
      .post('/api/v1/routes/search')
      .send({ originStationId, destinationStationId, routeMode: 'OPTIMAL' })
      .expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // 경로 검색은 로그인이 선택이라 OptionalClerkAuthGuard를 쓴다
      .overrideGuard(OptionalClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { ...user };
          return true;
        },
      })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
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
    prisma = app.get(PrismaService);
    await prisma.user.create({ data: user });
    await prisma.userPreference.create({
      data: { userId: user.id, purposes: [], routePrefs: ['AVOID_STAIRS'] },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await app.close();
  });

  it('scores the stairs axis when every candidate has vertical data', async () => {
    // 강남 -> 역삼(2호선 한 정거장). 두 역 모두 KRIC 출입구 경로와 서울교통공사 높이가 있다
    const res = await search('02_222', '02_221');
    expect(res.body.data.recommendation.unsupportedPreferences).not.toContain(
      'AVOID_STAIRS',
    );
  });

  it('reports the preference as unsupported when a candidate passes a station without data', async () => {
    // 도봉산 1호선(01_113)은 KRIC 출입구 경로가 없다
    const res = await search('01_113', '01_112');
    expect(res.body.data.recommendation.unsupportedPreferences).toContain(
      'AVOID_STAIRS',
    );
    for (const option of res.body.data.options) {
      expect(option.highlights).not.toContain('LEAST_VERTICAL');
    }
  });

  it('explains a route with less vertical travel using the actual station data', async () => {
    // 연신내 -> 잠실은 한 번 환승과 두 번 환승 후보의 오르내림이 다르다.
    const res = await search('03_321', '02_216');
    expect(res.body.data.recommendation.unsupportedPreferences).not.toContain(
      'AVOID_STAIRS',
    );
    const options = res.body.data.options;
    const meters = options.map(
      (o: { verticalTravelM: number }) => o.verticalTravelM,
    );
    expect(meters.every((m: number) => Number.isFinite(m))).toBe(true);
    const min = Math.min(...meters);
    expect(Math.max(...meters) - min).toBeGreaterThanOrEqual(6);
    for (const option of options) {
      expect(option.highlights.includes('LEAST_VERTICAL')).toBe(
        option.verticalTravelM === min,
      );
    }
  });

  it('compares elevator coverage and omits the tag if any candidate lacks facility data', async () => {
    const facilities = app.get(STATION_FACILITY_REPOSITORY);
    const realFind = facilities.findByStationId.bind(facilities);
    // 노선별 자료 비율을 제어하고 실제 파일에 빠진 역도 채워 전체 후보를 비교한다.
    const spy = jest
      .spyOn(facilities, 'findByStationId')
      .mockImplementation((id: string) => {
        const actual = realFind(id);
        return {
          ...(actual ?? { exits: [], stairDoors: [] }),
          elevatorDoors: id.startsWith('02_') ? ['1-1'] : [],
        };
      });
    try {
      await prisma.userPreference.update({
        where: { userId: user.id },
        data: { routePrefs: ['ELEVATOR'] },
      });
      const res = await search('03_321', '02_216');
      expect(res.body.data.recommendation.unsupportedPreferences).not.toContain(
        'ELEVATOR',
      );
      const options = res.body.data.options;
      const values = options.map(
        (o: { elevatorAccess: number }) => o.elevatorAccess,
      );
      expect(values.every((v: number) => Number.isFinite(v))).toBe(true);
      const max = Math.max(...values);
      expect(max - Math.min(...values)).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.highlights.includes('BEST_ELEVATOR_ACCESS')).toBe(
          option.elevatorAccess === max,
        );
      }

      spy.mockImplementation((id: string) =>
        id === '03_321' ? undefined : realFind(id),
      );
      const missing = await search('03_321', '02_216');
      expect(missing.body.data.recommendation.unsupportedPreferences).toContain(
        'ELEVATOR',
      );
      for (const option of missing.body.data.options) {
        expect(option.highlights).not.toContain('BEST_ELEVATOR_ACCESS');
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('treats SEAT like UNCROWDED instead of always reporting it unsupported', async () => {
    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { routePrefs: ['AVOID_STAIRS', 'SEAT', 'UNCROWDED'] },
    });
    const res = await search('02_222', '02_221');
    const { unsupportedPreferences: unsupported, reasons } =
      res.body.data.recommendation;
    expect(unsupported.includes('SEAT')).toBe(
      unsupported.includes('UNCROWDED'),
    );
    expect(reasons.includes('PREF_SEAT')).toBe(!unsupported.includes('SEAT'));
    expect(unsupported).not.toContain('AVOID_STAIRS');
  });
});
