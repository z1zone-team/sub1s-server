import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { FavoriteEndpoint } from '../../domain/user/models/favorite-route';
import { FavoriteEndpointDto } from './dto/favorite-route.dto';

/**
 * 즐겨찾기(경로의 양 끝, 장소)의 입력을 저장 형태로 바꾼다. 역이면 stationId, 아니면 lat, lng가 필요하고
 * 둘 다 오면 역이 우선한다. 없는 역 ID는 404
 */
export function toFavoriteEndpoint(
  dto: FavoriteEndpointDto,
  field: string,
  graphService: SubwayGraphService,
): FavoriteEndpoint {
  const hasStation = dto.stationId !== undefined;
  const hasCoords = dto.lat !== undefined && dto.lng !== undefined;

  if (!hasStation && !hasCoords) {
    throw new BusinessException(
      'INVALID_REQUEST_PAYLOAD',
      `${field}: stationId or lat and lng is required`,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (
    hasStation &&
    graphService.getGraph().indexOf(dto.stationId!) === undefined
  ) {
    throw new BusinessException(
      'STATION_NOT_FOUND',
      `station id not found: ${dto.stationId}`,
      HttpStatus.NOT_FOUND,
    );
  }
  return {
    name: dto.name,
    stationId: hasStation ? dto.stationId! : null,
    lat: hasStation ? null : dto.lat!,
    lng: hasStation ? null : dto.lng!,
  };
}
