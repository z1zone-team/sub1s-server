import { Injectable } from '@nestjs/common';
import { RankingNotifier } from '../../application/travel/ranking.notifier';
import { SubwayEventsGateway } from './subway-events.gateway';

/** 랭킹 변화를 WebSocket으로 보낸다(본인은 `ranking_update`, 전체는 `ranking_changed`) */
@Injectable()
export class WebsocketRankingNotifier extends RankingNotifier {
  constructor(private readonly gateway: SubwayEventsGateway) {
    super();
  }

  sendScoreUpdate(
    userId: string,
    payload: { periodKey: string; currentPoints: number },
  ): void {
    this.gateway.sendRankingUpdate(userId, payload);
  }

  broadcastChanged(payload: {
    periodType: 'MONTHLY' | 'ALL';
    periodKey: string;
  }): void {
    this.gateway.broadcastRankingChanged(payload);
  }
}
