import { Injectable } from '@nestjs/common';
import {
  SmartAlert,
  SmartAlertNotifier,
} from '../../application/tracking/smart-alert.notifier';
import { SubwayEventsGateway } from './subway-events.gateway';

/** 환승, 하차 한 역 전 알림을 WebSocket(`smart_alert`)으로 보낸다 */
@Injectable()
export class WebsocketSmartAlertNotifier extends SmartAlertNotifier {
  constructor(private readonly gateway: SubwayEventsGateway) {
    super();
  }

  sendSmartAlert(userId: string, alert: SmartAlert): void {
    this.gateway.sendSmartAlert(userId, alert);
  }
}
