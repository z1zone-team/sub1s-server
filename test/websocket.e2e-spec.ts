import { INestApplication, ValidationPipe } from '@nestjs/common';
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
});
