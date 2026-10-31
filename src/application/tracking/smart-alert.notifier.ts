/** 안내 중 환승, 하차 한 역 전 알림. `smart_alert` 소켓 이벤트의 내용과 같다 */
export interface SmartAlert {
  type: 'TRANSFER_PREPARE' | 'TRANSFER_NOW' | 'ALIGHT_PREPARE';
  message: string;
  recommendedDoor: string;
}

/**
 * 스마트 알림을 사용자에게 보내는 포트. 구현(WebSocket)은 infra에 있고
 * 이 계층은 어떤 방식으로 전달되는지 모른다
 */
export abstract class SmartAlertNotifier {
  abstract sendSmartAlert(userId: string, alert: SmartAlert): void;
}
