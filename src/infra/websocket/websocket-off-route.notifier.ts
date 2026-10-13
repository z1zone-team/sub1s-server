import { Injectable } from '@nestjs/common';
import { OffRouteAlertDto } from '../../application/tracking/dto/off-route-alert.dto';
import { OffRouteNotifier } from '../../application/tracking/off-route.notifier';
import { SubwayEventsGateway } from './subway-events.gateway';

/** 경로 이탈 알림을 WebSocket(`offroute_alert`)으로 보낸다 */
@Injectable()
export class WebsocketOffRouteNotifier extends OffRouteNotifier {
  constructor(private readonly gateway: SubwayEventsGateway) {
    super();
  }

  sendOffRouteAlert(userId: string, alert: OffRouteAlertDto): void {
    this.gateway.sendOffRouteAlert(userId, alert);
  }
}
