import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

describe('Guest access scope (e2e)', () => {
  let app: INestApplication;

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

  const call = (method: Method, path: string, body?: Record<string, unknown>, token?: string) => {
    let req = request(app.getHttpServer())[method](path);
    if (token) req = req.set('Authorization', token);
    return body ? req.send(body) : req;
  };

  // 로그인 없이 둘러보기에서 쓸 수 있는 API
  const open: [Method, string, Record<string, unknown>?][] = [
    ['get', '/api/health'],
    ['get', '/api/v1/places/search?q=강남'],
    ['get', '/api/v1/places/reverse?lat=37.4985&lng=127.0278'],
    ['get', '/api/v1/stations?ids=02_222'],
    ['get', '/api/v1/stations/02_222/next-trains'],
    ['get', '/api/v1/stations/02_222/facilities'],
    ['get', '/api/v1/trains/positions?lineId=02'],
    ['get', '/api/v1/congestion/train?lineId=02&trainId=2001&stationId=02_222'],
    ['post', '/api/v1/routes/search', { originStationId: '02_222', destinationStationId: '02_221' }],
  ];

  // 로그인이 필요한 API
  const protectedRoutes: [Method, string][] = [
    ['post', '/api/v1/auth/sync'],
    ['get', '/api/v1/auth/me'],
    ['get', '/api/v1/ranking?periodType=MONTHLY&periodKey=2026-10'],
    ['post', '/api/v1/routes/track/start'],
    ['post', '/api/v1/routes/track/deviate'],
    ['post', '/api/v1/routes/track/location'],
    ['post', '/api/v1/routes/track/position'],
    ['get', '/api/v1/routes/track/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/v1/line-map?period=ALL'],
    ['get', '/api/v1/users/me/places'],
    ['put', '/api/v1/users/me/places/HOME'],
    ['delete', '/api/v1/users/me/places/HOME'],
    ['get', '/api/v1/users/me/favorites/routes'],
    ['put', '/api/v1/users/me/favorites/routes'],
    ['delete', '/api/v1/users/me/favorites/routes/00000000-0000-0000-0000-000000000000'],
    ['post', '/api/v1/travel/log'],
    ['get', '/api/v1/travel/timeline'],
    ['get', '/api/v1/travel/stats'],
    ['get', '/api/v1/travel/line-map?period=ALL'],
    ['patch', '/api/v1/users/me'],
    ['get', '/api/v1/users/me/preferences'],
    ['put', '/api/v1/users/me/push-tokens'],
    ['delete', '/api/v1/users/me/push-tokens?token=ExponentPushToken%5Bx%5D'],
    ['get', '/api/v1/users/me/notification-settings'],
    ['patch', '/api/v1/users/me/notification-settings'],
    ['put', '/api/v1/users/me/preferences'],
    ['get', '/api/v1/friends'],
    ['get', '/api/v1/friends/invite'],
    ['post', '/api/v1/friends/invite/reset'],
    ['post', '/api/v1/friends/accept'],
    ['delete', '/api/v1/friends/00000000-0000-0000-0000-000000000000'],
    ['get', '/api/v1/voice/tts/stream'],
    ['post', '/api/v1/voice/jobs'],
    ['get', '/api/v1/voice/jobs/00000000-0000-0000-0000-000000000000'],
  ];

  describe('open to guests', () => {
    it.each(open.map(([method, path, body]) => [method, path, body ?? null] as const))(
      '%s %s answers 200 without a token',
      async (method, path, body) => {
        await call(method, path, body ?? undefined).expect(200);
      },
    );

    it('ignores an invalid Authorization header instead of rejecting the request', async () => {
      await call('get', '/api/v1/stations/02_222/facilities', undefined, 'Bearer not-a-real-token').expect(200);
    });
  });

  describe('login required', () => {
    it.each(protectedRoutes)('%s %s answers 401 without a token', async (method, path) => {
      const res = await call(method, path).expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it.each(protectedRoutes.slice(0, 6))('%s %s answers 401 for a malformed or invalid token', async (method, path) => {
      await call(method, path, undefined, 'Token abc').expect(401);
      await call(method, path, undefined, 'Bearer not-a-real-token').expect(401);
    });
  });

  // 컨트롤러에 경로가 추가되면 위 표에 분류하지 않았을 때 여기서 실패한다
  describe('route classification', () => {
    const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

    const discoveredRoutes = (): { method: string; pattern: RegExp; label: string }[] => {
      const routes: { method: string; pattern: RegExp; label: string }[] = [];
      for (const module of app.get(ModulesContainer).values()) {
        for (const wrapper of module.controllers.values()) {
          const controller = wrapper.metatype as { prototype: object } | null;
          if (!controller) continue;
          const basePaths = [Reflect.getMetadata(PATH_METADATA, controller)].flat().filter(Boolean) as string[];

          for (const name of Object.getOwnPropertyNames(controller.prototype)) {
            const handler = (controller.prototype as Record<string, unknown>)[name];
            if (typeof handler !== 'function') continue;
            const methodIndex = Reflect.getMetadata(METHOD_METADATA, handler);
            if (methodIndex === undefined) continue;
            const subPaths = [Reflect.getMetadata(PATH_METADATA, handler)].flat() as string[];

            for (const base of basePaths) {
              for (const sub of subPaths) {
                const path = `/api/${base}/${sub === '/' ? '' : sub}`.replace(/\/+/g, '/').replace(/\/$/, '');
                if (path.startsWith('/api/api/')) continue;
                routes.push({
                  method: METHODS[methodIndex],
                  pattern: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`),
                  label: `${METHODS[methodIndex]} ${path}`,
                });
              }
            }
          }
        }
      }
      return routes;
    };

    const classified = [
      ...open.map(([method, path]) => ({ method, path: path.split('?')[0] })),
      ...protectedRoutes.map(([method, path]) => ({ method, path: path.split('?')[0] })),
    ];

    it('has every route of every controller in the open or protected list', () => {
      expect(discoveredRoutes().length).toBeGreaterThanOrEqual(28);

      const missing = discoveredRoutes().filter(
        (route) => !classified.some((entry) => entry.method === route.method && route.pattern.test(entry.path)),
      );

      expect(missing.map((route) => route.label)).toEqual([]);
    });

    it('lists no route that does not exist any more', () => {
      const routes = discoveredRoutes();
      const stale = classified.filter(
        (entry) => !routes.some((route) => route.method === entry.method && route.pattern.test(entry.path)),
      );

      expect(stale).toEqual([]);
    });
  });
});
