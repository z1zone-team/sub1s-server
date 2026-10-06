import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { CongestionService } from '../../application/congestion/congestion.service';
import { TrainCongestionResponseDto } from '../../application/congestion/dto/train-congestion-response.dto';
import { SubwayGraph } from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { SubwayEventsGateway } from './subway-events.gateway';

describe('SubwayEventsGateway', () => {
  let gateway: SubwayEventsGateway;
  let mockCongestionService: { getTrainCongestion: jest.Mock };
  let mockGraphService: { getGraph: jest.Mock };
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

    it('sends eta_tick, smart_alert, offroute_alert, and ranking_update', () => {
      gateway.sendEtaTick('sess-1', {
        sessionId: 'sess-1',
        etaTimestamp: '2026-10-06T15:00:00Z',
        remainingSec: 180,
      });
      expect(mockServer.emit).toHaveBeenCalledWith(
        'eta_tick',
        expect.any(Object),
      );

      gateway.sendSmartAlert('sess-1', {
        type: 'TRANSFER_PREPARE',
        message: '잠시 후 환승역입니다.',
        recommendedDoor: '4-2',
      });
      expect(mockServer.emit).toHaveBeenCalledWith(
        'smart_alert',
        expect.any(Object),
      );

      gateway.sendOffRouteAlert('sess-1', { offroute: true });
      expect(mockServer.emit).toHaveBeenCalledWith(
        'offroute_alert',
        expect.any(Object),
      );

      gateway.broadcastRankingUpdate({ userId: 'u1', rank: 1 });
      expect(mockServer.emit).toHaveBeenCalledWith(
        'ranking_update',
        expect.any(Object),
      );
    });
  });
});
