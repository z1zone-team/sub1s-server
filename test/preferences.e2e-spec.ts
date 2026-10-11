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
import { ClerkAuthGuard } from '../src/infra/auth/clerk-auth.guard';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Onboarding preferences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tag = randomUUID().slice(0, 8);
  const me = { id: randomUUID(), clerkId: `e2e_pref_${tag}`, nickname: `pref_${tag}` };
  const other = { id: randomUUID(), clerkId: `e2e_pref_o_${tag}`, nickname: `pref_o_${tag}` };
  let currentUser = me;

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

  const getPrefs = () => request(app.getHttpServer()).get('/api/v1/users/me/preferences');
  const putPrefs = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).put('/api/v1/users/me/preferences').send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ClerkAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { ...currentUser };
          return true;
        },
      })
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

    prisma = app.get(PrismaService);
    await prisma.user.createMany({ data: [me, other] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } });
    await app.close();
  });

  beforeEach(() => {
    currentUser = me;
  });

  it('returns empty arrays before the survey and creates no row', async () => {
    const res = await getPrefs().expect(200);

    expect(res.body.data).toEqual({ purposes: [], routePrefs: [] });
    expect(await prisma.userPreference.count({ where: { userId: me.id } })).toBe(0);
  });

  it('saves the answers, removing duplicates, and reads them back', async () => {
    const saved = await putPrefs({
      purposes: ['COMMUTE', 'DATE', 'COMMUTE'],
      routePrefs: ['FAST', 'UNCROWDED'],
    }).expect(200);

    expect(saved.body.data).toEqual({
      purposes: ['COMMUTE', 'DATE'],
      routePrefs: ['FAST', 'UNCROWDED'],
    });
    expect((await getPrefs().expect(200)).body.data).toEqual(saved.body.data);
  });

  it('replaces the previous answers instead of merging', async () => {
    await putPrefs({ purposes: ['SCHOOL'], routePrefs: ['LESS_WALK'] }).expect(200);

    const res = await getPrefs().expect(200);

    expect(res.body.data).toEqual({ purposes: ['SCHOOL'], routePrefs: ['LESS_WALK'] });
    expect(await prisma.userPreference.count({ where: { userId: me.id } })).toBe(1);
  });

  it('keeps the other columns of the preference row', async () => {
    const row = await prisma.userPreference.findUnique({ where: { userId: me.id } });

    expect(row?.preferredMode).toBe('OPTIMAL');
  });

  it('keeps each user answers separate', async () => {
    currentUser = other;

    expect((await getPrefs().expect(200)).body.data).toEqual({ purposes: [], routePrefs: [] });
  });

  it.each([
    ['empty purposes', { purposes: [], routePrefs: ['FAST'] }],
    ['empty routePrefs', { purposes: ['COMMUTE'], routePrefs: [] }],
    ['unknown value', { purposes: ['출퇴근'], routePrefs: ['FAST'] }],
    ['extra field', { purposes: ['COMMUTE'], routePrefs: ['FAST'], extra: 1 }],
  ])('rejects %s with 400 and keeps the stored answers', async (_name, body) => {
    await putPrefs(body).expect(400);

    expect((await getPrefs().expect(200)).body.data).toEqual({
      purposes: ['SCHOOL'],
      routePrefs: ['LESS_WALK'],
    });
  });
});
