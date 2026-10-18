import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../src/domain/subway/ports/ISubwayGraphRepository';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { MOCK_USER_ID } from '../src/infra/auth/mock-auth.guard';
import { SubwayEventsGateway } from '../src/infra/websocket/subway-events.gateway';

describe('WebSocket SubwayEventsGateway (e2e)', () => {
  let app: INestApplication;
  let gateway: SubwayEventsGateway;
  let clientSocket: Socket;
  let port: number;

  const mockGraphRepository: ISubwayGraphRepository = {
    loadGraphData: async () => {
      const dataDir = resolve(__dirname, '../src/data/subway');
      const stations = JSON.parse(
        readFileSync(resolve(dataDir, 'stations.json'), 'utf-8'),
      );
      const edges = JSON.parse(
        readFileSync(resolve(dataDir, 'edges.json'), 'utf-8'),
      );
      const transfers = JSON.parse(
        readFileSync(resolve(dataDir, 'transfers.json'), 'utf-8'),
      );
      return { stations, edges, transfers };
    },
  };

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUBWAY_GRAPH_REPOSITORY)
      .useValue(mockGraphRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
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

    gateway = moduleRef.get<SubwayEventsGateway>(SubwayEventsGateway);

    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'string' ? Number(address) : address.port;
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    gateway.stopBroadcastTimer();
    await app.close();
  });

  it('connects to /ws/subway namespace, joins train room, and receives initial congestion_tick', (done) => {
    clientSocket = io(`http://localhost:${port}/ws/subway`, {
      transports: ['websocket'],
      autoConnect: true,
    });

    clientSocket.on('connect', () => {
      // Listen for congestion_tick
      clientSocket.on('congestion_tick', (tickData) => {
        try {
          expect(tickData.lineId).toBe('02');
          expect(tickData.trainId).toBe('2145');
          expect(tickData.stationId).toBe('02_222');
          expect(tickData.cars).toHaveLength(10);
          expect(typeof tickData.averageRate).toBe('number');
          expect(gateway.getActiveRoomsCount()).toBe(1);
          done();
        } catch (err) {
          done(err);
        }
      });

      // Emit join_train
      clientSocket.emit('join_train', {
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });
    });
  });

  it('receives congestion_tick broadcast when broadcastCongestionSnapshot is triggered', (done) => {
    let tickCount = 0;
    const tickHandler = () => {
      tickCount++;
      if (tickCount >= 1) {
        clientSocket.off('congestion_tick', tickHandler);
        done();
      }
    };

    clientSocket.on('congestion_tick', tickHandler);
    void gateway.broadcastCongestionSnapshot();
  });

  it('leaves train room via leave_train and cleans up active room upon disconnect', (done) => {
    clientSocket.emit('leave_train', { lineId: '02', trainId: '2145' }, () => {
      // acknowledgment callback or disconnect check
    });

    setTimeout(() => {
      try {
        expect(gateway.getActiveRoomsCount()).toBe(0);
        done();
      } catch (err) {
        done(err);
      }
    }, 100);
  });

  describe('handshake authentication and personal events', () => {
    const url = () => `http://localhost:${port}/ws/subway`;
    const open = (auth?: Record<string, string>): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const socket = io(url(), { transports: ['websocket'], auth });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', (error) => {
          socket.close();
          reject(error);
        });
      });
    const nextEvent = (socket: Socket, event: string, waitMs: number) =>
      new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), waitMs);
        socket.once(event, (payload: unknown) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

    it('refuses a socket whose token is present but invalid', async () => {
      await expect(open({ token: 'not-a-valid-token' })).rejects.toMatchObject({
        message: 'UNAUTHORIZED',
      });
    });

    it('delivers a personal alert only to the owner, not to a public socket', async () => {
      const owner = await open({ token: 'mock_jwt_token' });
      const publicSocket = await open();
      try {
        const ownerGot = nextEvent(owner, 'offroute_alert', 1500);
        const publicGot = nextEvent(publicSocket, 'offroute_alert', 500);

        gateway.sendOffRouteAlert(MOCK_USER_ID, { sessionId: 's1', secret: 'x' });

        expect(await ownerGot).toMatchObject({ sessionId: 's1' });
        expect(await publicGot).toBeUndefined();
      } finally {
        owner.close();
        publicSocket.close();
      }
    });

    it('delivers smart_alert to the owner when the reported position is one station before getting off', async () => {
      const AUTH = { Authorization: 'Bearer mock_jwt_token' };
      const owner = await open({ token: 'mock_jwt_token' });
      const publicSocket = await open();
      try {
        // 교대 -> 강남 -> 역삼 (2호선). 강남이 하차(역삼) 한 역 전이다
        const search = await request(app.getHttpServer())
          .post('/api/v1/routes/search')
          .set(AUTH)
          .send({ originStationId: '02_223', destinationStationId: '02_221', routeMode: 'OPTIMAL' })
          .expect(200);
        const start = await request(app.getHttpServer())
          .post('/api/v1/routes/track/start')
          .set(AUTH)
          .send({ routeOption: search.body.data.options[0] })
          .expect(201);

        const ownerGot = nextEvent(owner, 'smart_alert', 2000);
        const publicGot = nextEvent(publicSocket, 'smart_alert', 500);

        await request(app.getHttpServer())
          .post('/api/v1/routes/track/location')
          .set(AUTH)
          .send({ sessionId: start.body.data.sessionId, currentStationId: '02_222' })
          .expect(201);

        expect(await ownerGot).toMatchObject({
          type: 'ALIGHT_PREPARE',
          message: expect.stringContaining('역삼'),
        });
        expect(await publicGot).toBeUndefined();
      } finally {
        owner.close();
        publicSocket.close();
      }
    });

    it('sends ranking_changed to authenticated sockets only, and ranking_update to the owner', async () => {
      const owner = await open({ token: 'mock_jwt_token' });
      const publicSocket = await open();
      try {
        const changed = nextEvent(owner, 'ranking_changed', 1500);
        const update = nextEvent(owner, 'ranking_update', 1500);
        const publicChanged = nextEvent(publicSocket, 'ranking_changed', 500);

        gateway.broadcastRankingChanged({ periodType: 'MONTHLY', periodKey: '2026-10' });
        gateway.sendRankingUpdate(MOCK_USER_ID, {
          periodKey: '2026-10',
          currentPoints: 30,
        });

        expect(await changed).toEqual({ periodType: 'MONTHLY', periodKey: '2026-10' });
        expect(await update).toEqual({ periodKey: '2026-10', currentPoints: 30 });
        expect(await publicChanged).toBeUndefined();
      } finally {
        owner.close();
        publicSocket.close();
      }
    });

    it('still lets a public socket join a train room', async () => {
      const publicSocket = await open();
      try {
        const tick = nextEvent(publicSocket, 'congestion_tick', 3000);
        publicSocket.emit('join_train', { lineId: '02', trainId: '9999', stationId: '02_222' });

        expect(await tick).toMatchObject({ lineId: '02', trainId: '9999' });
      } finally {
        publicSocket.close();
      }
    });
  });
});
