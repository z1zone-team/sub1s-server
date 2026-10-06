import { OffRouteAlertReason } from '../../../domain/tracking/models/tracking-session';
import { SubwayRouteOptionDto } from '../../route/dto/route-search-response.dto';

export interface OffRouteAlertDto {
  sessionId: string;
  detectedStationId: string;
  detectedStationName: string;
  reason: OffRouteAlertReason;
  message: string;
  rerouteOption: SubwayRouteOptionDto;
  isOffRoute: boolean;
}
