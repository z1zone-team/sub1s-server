import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CongestionService } from '../../application/congestion/congestion.service';
import { TrainCongestionResponseDto } from '../../application/congestion/dto/train-congestion-response.dto';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { JoinTrainDto, LeaveTrainDto, ReportLocationDto } from './dto';

export interface ActiveTrainRoom {
  lineId: string;
  trainId: string;
  stationId?: string;
  clientIds: Set<string>;
}

export interface SmartAlertPayload {
  type: 'TRANSFER_PREPARE' | 'TRANSFER_NOW' | 'ALIGHT_PREPARE';
  message: string;
  recommendedDoor: string;
  audioUrl?: string;
}

export interface EtaTickPayload {
  sessionId: string;
  etaTimestamp: string;
  remainingSec: number;
}

@WebSocketGateway({
  namespace: '/ws/subway',
  cors: {
    origin: '*',
  },
})
export class SubwayEventsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SubwayEventsGateway.name);
  private broadcastTimer: NodeJS.Timeout | null = null;
  private readonly defaultStationCache = new Map<string, string>();

  // Active rooms: roomKey -> ActiveTrainRoom
  private readonly trainRooms = new Map<string, ActiveTrainRoom>();
  // Client subscriptions: clientId -> Set<roomKey>
  private readonly clientSubscriptions = new Map<string, Set<string>>();

  constructor(
    private readonly congestionService: CongestionService,
    private readonly graphService: SubwayGraphService,
  ) {}

  static getTrainRoomKey(lineId: string, trainId: string): string {
    return `train:${lineId}:${trainId}`;
  }

  onModuleInit(): void {
    this.startBroadcastTimer(30000);
  }

  onModuleDestroy(): void {
    this.stopBroadcastTimer();
  }

  afterInit(): void {
    this.logger.log('SubwayEventsGateway initialized on namespace /ws/subway');
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
    const clientRooms = this.clientSubscriptions.get(client.id);
    if (clientRooms) {
      for (const roomKey of Array.from(clientRooms)) {
        this.removeClientFromRoom(client.id, roomKey);
      }
    }
  }

  @SubscribeMessage('join_train')
  async handleJoinTrain(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinTrainDto,
  ): Promise<{
    event: string;
    data: { room: string; lineId: string; trainId: string };
  }> {
    const data =
      typeof payload === 'string'
        ? (JSON.parse(payload) as JoinTrainDto)
        : payload;
    if (!data?.lineId || !data?.trainId) {
      throw new Error('lineId and trainId are required');
    }

    const roomKey = SubwayEventsGateway.getTrainRoomKey(
      data.lineId,
      data.trainId,
    );
    await client.join(roomKey);

    let room = this.trainRooms.get(roomKey);
    if (!room) {
      room = {
        lineId: data.lineId,
        trainId: data.trainId,
        stationId: data.stationId,
        clientIds: new Set<string>(),
      };
      this.trainRooms.set(roomKey, room);
    } else if (data.stationId) {
      room.stationId = data.stationId;
    }
    room.clientIds.add(client.id);

    let clientRooms = this.clientSubscriptions.get(client.id);
    if (!clientRooms) {
      clientRooms = new Set<string>();
      this.clientSubscriptions.set(client.id, clientRooms);
    }
    clientRooms.add(roomKey);

    this.logger.debug(
      `Client ${client.id} joined room ${roomKey} (total subscribers: ${room.clientIds.size})`,
    );

    // Initial snapshot emit to the joining client
    try {
      const snapshot = await this.getCongestionForRoom(room);
      if (snapshot) {
        client.emit('congestion_tick', snapshot);
      }
    } catch (err) {
      this.logger.warn(`Initial snapshot failed for room ${roomKey}: ${err}`);
    }

    return {
      event: 'joined_train',
      data: { room: roomKey, lineId: data.lineId, trainId: data.trainId },
    };
  }

  @SubscribeMessage('leave_train')
  async handleLeaveTrain(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveTrainDto,
  ): Promise<{ event: string; data: { room: string; left: boolean } }> {
    const data =
      typeof payload === 'string'
        ? (JSON.parse(payload) as LeaveTrainDto)
        : payload;
    if (!data?.lineId || !data?.trainId) {
      throw new Error('lineId and trainId are required');
    }

    const roomKey = SubwayEventsGateway.getTrainRoomKey(
      data.lineId,
      data.trainId,
    );
    await client.leave(roomKey);

    this.removeClientFromRoom(client.id, roomKey);

    return {
      event: 'left_train',
      data: { room: roomKey, left: true },
    };
  }

  @SubscribeMessage('report_location')
  handleReportLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReportLocationDto,
  ): { event: string; status: string; data: ReportLocationDto } {
    const data =
      typeof payload === 'string'
        ? (JSON.parse(payload) as ReportLocationDto)
        : payload;
    this.logger.debug(
      `Location reported for session ${data?.sessionId}: station ${data?.currentStationId}`,
    );

    // Update stationId for any room this client is currently subscribed to
    const clientRooms = this.clientSubscriptions.get(client.id);
    if (clientRooms && data?.currentStationId) {
      for (const roomKey of clientRooms) {
        const room = this.trainRooms.get(roomKey);
        if (room) {
          room.stationId = data.currentStationId;
        }
      }
    }

    return {
      event: 'location_reported',
      status: 'OK',
      data,
    };
  }

  /**
   * Single Producer - Fan-out: Calculates train snapshot once per active room and broadcasts
   * to all connected subscribers in the room.
   */
  async broadcastCongestionSnapshot(): Promise<void> {
    if (this.trainRooms.size === 0) {
      return;
    }

    for (const [roomKey, room] of Array.from(this.trainRooms.entries())) {
      if (room.clientIds.size === 0) {
        this.trainRooms.delete(roomKey);
        continue;
      }

      try {
        const snapshot = await this.getCongestionForRoom(room);
        if (snapshot && this.server) {
          this.server.to(roomKey).emit('congestion_tick', snapshot);
        }
      } catch (err) {
        this.logger.error(
          `Failed to broadcast congestion for ${roomKey}:`,
          err,
        );
      }
    }
  }

  startBroadcastTimer(intervalMs = 30000): void {
    this.stopBroadcastTimer();
    this.broadcastTimer = setInterval(() => {
      void this.broadcastCongestionSnapshot();
    }, intervalMs);
    this.logger.log(
      `Congestion broadcast scheduler started (interval: ${intervalMs}ms)`,
    );
  }

  stopBroadcastTimer(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
      this.logger.log('Congestion broadcast scheduler stopped');
    }
  }

  sendEtaTick(sessionId: string, payload: EtaTickPayload): void {
    if (this.server) {
      this.server.emit('eta_tick', payload);
    }
  }

  sendSmartAlert(sessionId: string, payload: SmartAlertPayload): void {
    if (this.server) {
      this.server.emit('smart_alert', payload);
    }
  }

  sendOffRouteAlert(sessionId: string, payload: unknown): void {
    if (this.server) {
      this.server.emit('offroute_alert', payload);
    }
  }

  broadcastRankingUpdate(payload: unknown): void {
    if (this.server) {
      this.server.emit('ranking_update', payload);
    }
  }

  getActiveRoomsCount(): number {
    return this.trainRooms.size;
  }

  getActiveRoom(roomKey: string): ActiveTrainRoom | undefined {
    return this.trainRooms.get(roomKey);
  }

  isClientInRoom(clientId: string, roomKey: string): boolean {
    const room = this.trainRooms.get(roomKey);
    return room ? room.clientIds.has(clientId) : false;
  }

  private removeClientFromRoom(clientId: string, roomKey: string): void {
    const room = this.trainRooms.get(roomKey);
    if (room) {
      room.clientIds.delete(clientId);
      if (room.clientIds.size === 0) {
        this.trainRooms.delete(roomKey);
        this.logger.debug(`Room ${roomKey} deleted as all clients left`);
      }
    }

    const clientRooms = this.clientSubscriptions.get(clientId);
    if (clientRooms) {
      clientRooms.delete(roomKey);
      if (clientRooms.size === 0) {
        this.clientSubscriptions.delete(clientId);
      }
    }
  }

  private async getCongestionForRoom(
    room: ActiveTrainRoom,
  ): Promise<TrainCongestionResponseDto | null> {
    let stationId = room.stationId;
    if (!stationId) {
      stationId = this.findDefaultStationForLine(room.lineId);
    }
    if (!stationId) {
      return null;
    }

    return this.congestionService.getTrainCongestion({
      lineId: room.lineId,
      trainId: room.trainId,
      stationId,
    });
  }

  private findDefaultStationForLine(lineId: string): string | undefined {
    if (this.defaultStationCache.has(lineId)) {
      return this.defaultStationCache.get(lineId);
    }
    try {
      const graph = this.graphService.getGraph();
      for (let i = 0; i < graph.stationCount; i++) {
        const st = graph.station(i);
        if (st.lineId === lineId) {
          this.defaultStationCache.set(lineId, st.id);
          return st.id;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not lookup default station for line ${lineId}: ${err}`,
      );
    }
    return undefined;
  }
}
