import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { CongestionService } from '../../application/congestion/congestion.service';
import { TrainCongestionResponseDto } from '../../application/congestion/dto/train-congestion-response.dto';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { ClerkTokenService } from '../auth/clerk-token.service';
import { SubwayEventsGateway } from './subway-events.gateway';

describe('SubwayEventsGateway', () => {
  let gateway: SubwayEventsGateway;
  let mockCongestionService: { getTrainCongestion: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
  let mockTokenService: { authenticate: jest.Mock };
  let mockServer: { to: jest.Mock; emit: jest.Mock };
  let mockEmitToRoom: jest.Mock;

  const testGraph = new SubwayGraph({
    stations: [
      {
        id: '02_222',
        lineId: '02',
        stationName: '강남',
        lat: 37.4979,
        lng: 127.0276,
        lineSeq: 1,
      },
    ],
    edges: [],
    transfers: [],
  });

  const mockSnapshot: TrainCongestionResponseDto = {
    lineId: '02',
    trainId: '2145',
    stationId: '02_222',
    averageRate: 55,
    source: 'STATISTICS',
    cars: [
      { carNo: 1, rate: 50, level: '보통', isWeakAirConditioned: false },
      { carNo: 2, rate: 60, level: '보통', isWeakAirConditioned: false },
    ],
    updatedAt: new Date().toISOString(),
  };

  const createMockSocket = (
    id: string,
  ): Partial<Socket> & {
    join: jest.Mock;
    leave: jest.Mock;
    emit: jest.Mock;
  } => ({
    id,
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  });

  beforeEach(async () => {
    mockEmitToRoom = jest.fn();
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: mockEmitToRoom }),
      emit: jest.fn(),
    };

    mockCongestionService = {
      getTrainCongestion: jest.fn().mockResolvedValue(mockSnapshot),
    };

    mockGraphService = {
      getGraph: jest.fn().mockReturnValue(testGraph),
    };

    mockTokenService = { authenticate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubwayEventsGateway,
        {
          provide: CongestionService,
          useValue: mockCongestionService,
        },
        {
          provide: SubwayGraphService,
          useValue: mockGraphService,
        },
        {
          provide: ClerkTokenService,
          useValue: mockTokenService,
        },
      ],
    }).compile();

    gateway = module.get<SubwayEventsGateway>(SubwayEventsGateway);
    gateway.server = mockServer as unknown as Server;
  });

  afterEach(() => {
    gateway.stopBroadcastTimer();
    jest.clearAllMocks();
  });

  describe('Static helpers', () => {
    it('generates isolated room key according to standard format', () => {
      const roomKey = SubwayEventsGateway.getTrainRoomKey('02', '2145');
      expect(roomKey).toBe('train:02:2145');
    });
  });

  describe('join_train & leave_train lifecycle', () => {
    it('joins a room, registers client subscription, and emits initial snapshot', async () => {
      const client = createMockSocket('client-1');

      const response = await gateway.handleJoinTrain(
        client as unknown as Socket,
        {
          lineId: '02',
          trainId: '2145',
          stationId: '02_222',
        },
      );

      expect(response.event).toBe('joined_train');
      expect(response.data.room).toBe('train:02:2145');
      expect(client.join).toHaveBeenCalledWith('train:02:2145');
      expect(gateway.getActiveRoomsCount()).toBe(1);
      expect(gateway.isClientInRoom('client-1', 'train:02:2145')).toBe(true);

      // Emitted initial snapshot directly to the joining client
      expect(client.emit).toHaveBeenCalledWith('congestion_tick', mockSnapshot);
    });

    it('falls back to default line station if stationId is omitted in join_train', async () => {
      const client = createMockSocket('client-1');

      await gateway.handleJoinTrain(client as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });

      expect(mockCongestionService.getTrainCongestion).toHaveBeenCalledWith({
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });
    });

    it('manages multiple subscribers in the same room', async () => {
      const client1 = createMockSocket('client-1');
      const client2 = createMockSocket('client-2');

      await gateway.handleJoinTrain(client1 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });
      await gateway.handleJoinTrain(client2 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });

      expect(gateway.getActiveRoomsCount()).toBe(1);
      const room = gateway.getActiveRoom('train:02:2145');
      expect(room?.clientIds.size).toBe(2);
      expect(gateway.isClientInRoom('client-1', 'train:02:2145')).toBe(true);
      expect(gateway.isClientInRoom('client-2', 'train:02:2145')).toBe(true);
    });

    it('leaves a room and deletes the room when the last subscriber leaves', async () => {
      const client = createMockSocket('client-1');

      await gateway.handleJoinTrain(client as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });
      expect(gateway.getActiveRoomsCount()).toBe(1);

      const leaveResponse = await gateway.handleLeaveTrain(
        client as unknown as Socket,
        {
          lineId: '02',
          trainId: '2145',
        },
      );

      expect(leaveResponse.event).toBe('left_train');
      expect(leaveResponse.data.left).toBe(true);
      expect(client.leave).toHaveBeenCalledWith('train:02:2145');
      expect(gateway.getActiveRoomsCount()).toBe(0);
    });

    it('keeps the room active when one of multiple subscribers leaves', async () => {
      const client1 = createMockSocket('client-1');
      const client2 = createMockSocket('client-2');

      await gateway.handleJoinTrain(client1 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });
      await gateway.handleJoinTrain(client2 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });

      await gateway.handleLeaveTrain(client1 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });

      expect(gateway.getActiveRoomsCount()).toBe(1);
      expect(gateway.isClientInRoom('client-1', 'train:02:2145')).toBe(false);
      expect(gateway.isClientInRoom('client-2', 'train:02:2145')).toBe(true);
    });
  });

  describe('handleDisconnect', () => {
    it('cleans up client subscriptions and removes empty rooms on disconnect', async () => {
      const client = createMockSocket('client-1');

      await gateway.handleJoinTrain(client as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });
      expect(gateway.getActiveRoomsCount()).toBe(1);

      gateway.handleDisconnect(client as unknown as Socket);

      expect(gateway.getActiveRoomsCount()).toBe(0);
      expect(gateway.isClientInRoom('client-1', 'train:02:2145')).toBe(false);
    });
  });

  describe('report_location', () => {
    it('updates active room station and returns acknowledgment', async () => {
      const client = createMockSocket('client-1');

      await gateway.handleJoinTrain(client as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
      });

      const response = gateway.handleReportLocation(
        client as unknown as Socket,
        {
          sessionId: 'session-xyz',
          currentStationId: '02_222',
        },
      );

      expect(response.event).toBe('location_reported');
      expect(response.status).toBe('OK');
      const room = gateway.getActiveRoom('train:02:2145');
      expect(room?.stationId).toBe('02_222');
    });
  });

  describe('Single Producer - Fan-out congestion broadcast', () => {
    it('does nothing when there are no active rooms (0 CPU / 0 DB overhead)', async () => {
      await gateway.broadcastCongestionSnapshot();

      expect(mockCongestionService.getTrainCongestion).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('calculates congestion once per active room and emits to the room', async () => {
      const client1 = createMockSocket('client-1');
      const client2 = createMockSocket('client-2');

      await gateway.handleJoinTrain(client1 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });
      await gateway.handleJoinTrain(client2 as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });

      jest.clearAllMocks();

      // Trigger 30s broadcast
      await gateway.broadcastCongestionSnapshot();

      // 1 Calculation for the entire room regardless of subscriber count
      expect(mockCongestionService.getTrainCongestion).toHaveBeenCalledTimes(1);
      expect(mockCongestionService.getTrainCongestion).toHaveBeenCalledWith({
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });

      // 1 Fan-out emit to the room
      expect(mockServer.to).toHaveBeenCalledWith('train:02:2145');
      expect(mockEmitToRoom).toHaveBeenCalledWith(
        'congestion_tick',
        mockSnapshot,
      );
    });

    it('handles snapshot error gracefully without throwing', async () => {
      const client = createMockSocket('client-1');
      await gateway.handleJoinTrain(client as unknown as Socket, {
        lineId: '02',
        trainId: '2145',
        stationId: '02_222',
      });

      mockCongestionService.getTrainCongestion.mockRejectedValueOnce(
        new Error('Database unavailable'),
      );

      await expect(
        gateway.broadcastCongestionSnapshot(),
      ).resolves.not.toThrow();
    });
  });

  describe('Lifecycle and alerts', () => {
    it('starts and stops broadcast timer cleanly', () => {
      gateway.onModuleInit();
      gateway.onModuleDestroy();
      // Should not throw or leak handles
    });

    it('sends personal events only to the owner user room, never to everyone', () => {
      gateway.sendEtaTick('user-1', {
        sessionId: 'sess-1',
        etaTimestamp: '2026-10-06T15:00:00Z',
        remainingSec: 180,
      });
      gateway.sendSmartAlert('user-1', {
        type: 'TRANSFER_PREPARE',
        message: '잠시 후 환승역입니다.',
        recommendedDoor: '4-2',
      });
      gateway.sendOffRouteAlert('user-1', { offroute: true });
      gateway.sendRankingUpdate('user-1', {
        periodKey: '2026-10',
        currentPoints: 2480,
      });

      expect(mockServer.to).toHaveBeenCalledTimes(4);
      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockServer.emit).not.toHaveBeenCalled();
      expect(mockEmitToRoom.mock.calls.map(([event]) => event)).toEqual([
        'eta_tick',
        'smart_alert',
        'offroute_alert',
        'ranking_update',
      ]);
    });

    it('does not mix up the rooms of two users', () => {
      gateway.sendOffRouteAlert('user-1', { a: 1 });
      gateway.sendOffRouteAlert('user-2', { b: 2 });

      expect(mockServer.to).toHaveBeenNthCalledWith(1, 'user:user-1');
      expect(mockServer.to).toHaveBeenNthCalledWith(2, 'user:user-2');
    });

    it('sends the anonymous ranking_changed signal to authenticated sockets only, without user data', () => {
      gateway.broadcastRankingChanged({ periodType: 'MONTHLY', periodKey: '2026-10' });

      expect(mockServer.to).toHaveBeenCalledWith('authenticated');
      expect(mockEmitToRoom).toHaveBeenCalledWith('ranking_changed', {
        periodType: 'MONTHLY',
        periodKey: '2026-10',
      });
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('Handshake authentication', () => {
    type Middleware = (
      socket: unknown,
      next: (error?: Error) => void,
    ) => void;

    const setup = () => {
      let middleware: Middleware | undefined;
      gateway.afterInit({
        use: (fn: Middleware) => {
          middleware = fn;
        },
      } as unknown as Server);
      return middleware as Middleware;
    };

    const handshake = (
      auth: Record<string, unknown> = {},
      headers: Record<string, string> = {},
    ) => ({ handshake: { auth, headers }, data: {} as Record<string, unknown> });

    const run = (middleware: Middleware, socket: unknown) =>
      new Promise<Error | undefined>((resolve) => middleware(socket, resolve));

    it('lets a socket without a token connect as a public socket', async () => {
      const socket = handshake();

      const error = await run(setup(), socket);

      expect(error).toBeUndefined();
      expect(socket.data.user).toBeUndefined();
      expect(mockTokenService.authenticate).not.toHaveBeenCalled();
    });

    it('authenticates the token sent in handshake auth', async () => {
      mockTokenService.authenticate.mockResolvedValue({ id: 'user-1' });
      const socket = handshake({ token: 'abc' });

      const error = await run(setup(), socket);

      expect(error).toBeUndefined();
      expect(mockTokenService.authenticate).toHaveBeenCalledWith('abc');
      expect(socket.data.user).toEqual({ id: 'user-1' });
    });

    it('accepts a Bearer Authorization header as well', async () => {
      mockTokenService.authenticate.mockResolvedValue({ id: 'user-1' });
      const socket = handshake({}, { authorization: 'Bearer xyz' });

      await run(setup(), socket);

      expect(mockTokenService.authenticate).toHaveBeenCalledWith('xyz');
    });

    it('refuses a token that is present but invalid', async () => {
      mockTokenService.authenticate.mockRejectedValue(new Error('expired'));
      const socket = handshake({ token: 'bad' });

      const error = await run(setup(), socket);

      expect(error?.message).toBe('UNAUTHORIZED');
      expect(socket.data.user).toBeUndefined();
    });

    it('puts an authenticated socket into its user room and the authenticated room', () => {
      const client = createMockSocket('sock-1');
      (client as unknown as { data: unknown }).data = { user: { id: 'user-1' } };

      gateway.handleConnection(client as unknown as Socket);

      expect(client.join).toHaveBeenCalledWith(['user:user-1', 'authenticated']);
    });

    it('does not put a public socket into any personal room', () => {
      const client = createMockSocket('sock-2');
      (client as unknown as { data: unknown }).data = {};

      gateway.handleConnection(client as unknown as Socket);

      expect(client.join).not.toHaveBeenCalled();
    });
  });
});
