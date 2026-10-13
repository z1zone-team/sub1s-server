import { OffRouteAlertDto } from './dto/off-route-alert.dto';

/**
 * 경로 이탈을 사용자에게 알리는 포트. 구현(WebSocket)은 infra에 있고
 * 이 계층은 어떤 방식으로 전달되는지 모른다
 */
export abstract class OffRouteNotifier {
  abstract sendOffRouteAlert(userId: string, alert: OffRouteAlertDto): void;
}
