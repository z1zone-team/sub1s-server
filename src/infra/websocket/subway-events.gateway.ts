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
import { ClerkTokenService } from '../auth/clerk-token.service';
import { AuthUser } from '../auth/current-user.decorator';
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
}

export interface RankingUpdatePayload {
  periodKey: string;
  currentPoints: number;
}

// 사용자 정보가 없는 익명 갱신 신호
export interface RankingChangedPayload {
  periodType: 'MONTHLY' | 'ALL';
  periodKey: string;
}

/** 음성 작업이 성공했을 때 요청한 사용자에게만 보내는 신호 */
export interface VoiceResultPayload {
  jobId: string;
  result: unknown;
}

/** 음성 작업이 실패했을 때 요청한 사용자에게만 보내는 신호 (HTTP 오류 응답과 같은 코드와 메시지) */
export interface VoiceFailedPayload {
  jobId: string;
  error: { code: string; message: string; status: number };
}

const AUTHENTICATED_ROOM = 'authenticated';

/** 한 연결이 동시에 구독할 수 있는 열차 방 수 */
const MAX_ROOMS_PER_CLIENT = 5;
/** 서버 전체의 열차 방 수. 방마다 30초마다 혼잡도를 계산하므로 넘으면 새 방을 받지 않는다 */
const MAX_TRAIN_ROOMS = 500;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

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
    private readonly tokenService: ClerkTokenService,
  ) {}

  static getTrainRoomKey(lineId: string, trainId: string): string {
    return `train:${lineId}:${trainId}`;
  }

  static getUserRoomKey(userId: string): string {
    return `user:${userId}`;
  }

  onModuleInit(): void {
    this.startBroadcastTimer(30000);
  }

  onModuleDestroy(): void {
    this.stopBroadcastTimer();
  }

  afterInit(server: Server): void {
    // 토큰이 없으면 공개 소켓(혼잡도 룸만), 토큰이 있는데 잘못되면 거부한다
    server.use((socket, next) => {
      void this.authenticateHandshake(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
    this.logger.log('SubwayEventsGateway initialized on namespace /ws/subway');
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
    const user = client.data?.user as AuthUser | undefined;
    if (user) {
      void client.join([
        SubwayEventsGateway.getUserRoomKey(user.id),
        AUTHENTICATED_ROOM,
      ]);
    }
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
    this.assertValidJoin(data);

    const roomKey = SubwayEventsGateway.getTrainRoomKey(
      data.lineId,
      data.trainId,
    );
    const existing = this.trainRooms.get(roomKey);
    const subscribed = this.clientSubscriptions.get(client.id);
    if (!subscribed?.has(roomKey)) {
      if ((subscribed?.size ?? 0) >= MAX_ROOMS_PER_CLIENT) {
        throw new Error('too many train subscriptions');
      }
      if (!existing && this.trainRooms.size >= MAX_TRAIN_ROOMS) {
        throw new Error('too many active train rooms');
      }
    }
    await client.join(roomKey);

    // 기준 역은 방을 만들 때만 정한다. 나중에 들어오는 연결이 같은 방의 역을 바꾸지 못한다
    let room = existing;
    if (!room) {
      room = {
        lineId: data.lineId,
        trainId: data.trainId,
        stationId: data.stationId,
        clientIds: new Set<string>(),
      };
      this.trainRooms.set(roomKey, room);
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

    // 클라이언트가 신고한 위치는 여러 사용자가 함께 보는 열차 방의 상태를 바꾸지 않는다
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

  sendEtaTick(userId: string, payload: EtaTickPayload): void {
    this.emitToUser(userId, 'eta_tick', payload);
  }

  sendSmartAlert(userId: string, payload: SmartAlertPayload): void {
    this.emitToUser(userId, 'smart_alert', payload);
  }

  sendOffRouteAlert(userId: string, payload: unknown): void {
    this.emitToUser(userId, 'offroute_alert', payload);
  }

  sendVoiceResult(userId: string, payload: VoiceResultPayload): void {
    this.emitToUser(userId, 'voice_result', payload);
  }

  sendVoiceFailed(userId: string, payload: VoiceFailedPayload): void {
    this.emitToUser(userId, 'voice_failed', payload);
  }

  sendRankingUpdate(userId: string, payload: RankingUpdatePayload): void {
    this.emitToUser(userId, 'ranking_update', payload);
  }

  broadcastRankingChanged(payload: RankingChangedPayload): void {
    if (this.server) {
      this.server.to(AUTHENTICATED_ROOM).emit('ranking_changed', payload);
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

  private emitToUser(userId: string, event: string, payload: unknown): void {
    if (this.server) {
      this.server
        .to(SubwayEventsGateway.getUserRoomKey(userId))
        .emit(event, payload);
    }
  }

  private async authenticateHandshake(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) return;
    try {
      socket.data.user = await this.tokenService.authenticate(token);
    } catch {
      throw new Error('UNAUTHORIZED');
    }
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken: unknown = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }
    const header = socket.handshake.headers?.authorization;
    const match =
      typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
    return match?.[1]?.trim() || undefined;
  }

  private assertValidJoin(data: JoinTrainDto): void {
    if (!ID_PATTERN.test(data.lineId) || !ID_PATTERN.test(data.trainId)) {
      throw new Error('invalid lineId or trainId');
    }
    const graph = this.graphService.getGraph();
    if (!this.findDefaultStationForLine(data.lineId)) {
      throw new Error(`unknown line: ${data.lineId}`);
    }
    if (data.stationId !== undefined) {
      const index = graph.indexOf(data.stationId);
      if (index === undefined || graph.station(index).lineId !== data.lineId) {
        throw new Error('stationId is not a station of the line');
      }
    }
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
