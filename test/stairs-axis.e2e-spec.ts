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
  });

  it('keeps reporting SEAT as unsupported', async () => {
    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { routePrefs: ['AVOID_STAIRS', 'SEAT'] },
    });
    const res = await search('02_222', '02_221');
    const unsupported = res.body.data.recommendation.unsupportedPreferences;
    expect(unsupported).toContain('SEAT');
    expect(unsupported).not.toContain('AVOID_STAIRS');
  });
});
