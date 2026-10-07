import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { createClerkClient } from '@clerk/backend';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

describe('Clerk Authentication Live Integration (e2e)', () => {
  let app: INestApplication;
  const secretKey = process.env.CLERK_SECRET_KEY;
  let clerk: ReturnType<typeof createClerkClient>;
  let testUserId: string | null = null;
  let testSessionId: string | null = null;
  let validJwtToken: string | null = null;

  beforeAll(async () => {
    if (!secretKey) {
      console.warn('Skipping live Clerk E2E: CLERK_SECRET_KEY not found');
      return;
    }

    clerk = createClerkClient({ secretKey });

    // 1. Clerk Cloud에 실시간 테스트 유저 생성
    const testUser = await clerk.users.createUser({
      firstName: 'Sub1S',
      lastName: 'LiveTester',
    });
    testUserId = testUser.id;

    // 2. 실시간 세션 생성 및 실제 Clerk JWT 서명 토큰 발급
    const session = await clerk.sessions.createSession({ userId: testUser.id });
    testSessionId = session.id;
    const tokenObj = await clerk.sessions.getToken(session.id);
    validJwtToken = tokenObj.jwt;

    // 3. 실제 NestJS 서버 인스턴스 기동 (실제 DB 연결)
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (clerk && testSessionId) {
      try {
        await clerk.sessions.revokeSession(testSessionId);
      } catch {}
    }
    if (clerk && testUserId) {
      try {
        await clerk.users.deleteUser(testUserId);
      } catch {}
    }
  }, 30000);

  it('토큰 미제공 시 401 UNAUTHORIZED 에러 반환', async () => {
    if (!validJwtToken) return;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sync')
      .send({ nickname: '테스터' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('위조/변조된 토큰 전송 시 401 UNAUTHORIZED 에러 반환', async () => {
    if (!validJwtToken) return;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sync')
      .set('Authorization', 'Bearer invalid_tampered_clerk_jwt_token_xyz')
      .send({ nickname: '테스터' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('실제 Clerk 세션 JWT 토큰으로 인증 통과 및 PostgreSQL DB에 유저 동기화(sync)', async () => {
    if (!validJwtToken) return;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sync')
      .set('Authorization', `Bearer ${validJwtToken}`)
      .send({ nickname: '실시간탐험가' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.clerkId).toBe(testUserId);
    expect(res.body.data.nickname).toBe('실시간탐험가');
    expect(res.body.data.userId).toBeDefined();
  });

  it('실제 토큰으로 GET /api/v1/auth/me 프로필 조회 성공', async () => {
    if (!validJwtToken) return;

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${validJwtToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.clerkId).toBe(testUserId);
    expect(res.body.data.nickname).toBe('실시간탐험가');
    expect(res.body.data.isRankingPublic).toBe(true);
  });

  it('실제 토큰으로 POST /api/v1/travel/log 호출 시 정상 인가 및 이동 기록 저장', async () => {
    if (!validJwtToken) return;

    const res = await request(app.getHttpServer())
      .post('/api/v1/travel/log')
      .set('Authorization', `Bearer ${validJwtToken}`)
      .send({
        originStationId: '02_222',
        destStationId: '02_221',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.logId).toBeDefined();
    expect(res.body.data.totalDistanceKm).toBeGreaterThan(0);
  });

  it('실제 토큰으로 GET /api/v1/ranking 호출 시 내 랭킹 및 리더보드 정상 반환', async () => {
    if (!validJwtToken) return;

    const now = new Date();
    const monthlyKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/ranking?periodType=MONTHLY&periodKey=${monthlyKey}`)
      .set('Authorization', `Bearer ${validJwtToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.myRank).toBeGreaterThanOrEqual(1);
    expect(res.body.data.myPoints).toBeGreaterThan(0);
  });
});
