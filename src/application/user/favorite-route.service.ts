import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { toKstIso } from '../../common/utils/kst';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  endpointKey,
  FAVORITE_ROUTE_LIMIT,
  FavoriteEndpoint,
  FavoriteRoute,
  routeKeyOf,
} from '../../domain/user/models/favorite-route';
import {
  FAVORITE_ROUTE_REPOSITORY,
  IFavoriteRouteRepository,
} from '../../domain/user/ports/IFavoriteRouteRepository';
import {
  FavoriteEndpointDto,
  FavoriteRouteResponseDto,
  FavoriteRoutesResponseDto,
  RemoveFavoriteRouteResponseDto,
  SaveFavoriteRouteRequestDto,
  SaveFavoriteRouteResponseDto,
} from './dto/favorite-route.dto';

const toResponse = (favorite: FavoriteRoute): FavoriteRouteResponseDto => ({
  id: favorite.id,
  origin: favorite.origin,
  destination: favorite.destination,
  createdAt: toKstIso(favorite.createdAt),
});

@Injectable()
export class FavoriteRouteService {
  constructor(
    @Inject(FAVORITE_ROUTE_REPOSITORY)
    private readonly favoriteRepo: IFavoriteRouteRepository,
    private readonly graphService: SubwayGraphService,
  ) {}

  async list(userId: string): Promise<FavoriteRoutesResponseDto> {
    const favorites = await this.favoriteRepo.findAll(userId);
    return { favorites: favorites.map(toResponse), limit: FAVORITE_ROUTE_LIMIT };
  }

  /** 같은 경로가 이미 있으면 새로 만들지 않고 그것을 돌려준다(`alreadySaved`). 가득 찼으면 409 */
  async save(
    userId: string,
    dto: SaveFavoriteRouteRequestDto,
  ): Promise<SaveFavoriteRouteResponseDto> {
    const origin = this.toEndpoint(dto.origin, 'origin');
    const destination = this.toEndpoint(dto.destination, 'destination');

    if (endpointKey(origin) === endpointKey(destination)) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'origin and destination must differ',
        HttpStatus.BAD_REQUEST,
      );
    }
    const routeKey = routeKeyOf(origin, destination);

    const existing = await this.favoriteRepo.findByKey(userId, routeKey);
    if (existing) return { ...toResponse(existing), alreadySaved: true };

    if ((await this.favoriteRepo.count(userId)) >= FAVORITE_ROUTE_LIMIT) {
      throw new BusinessException(
        'FAVORITE_ROUTE_LIMIT',
        `favorite routes are limited to ${FAVORITE_ROUTE_LIMIT}`,
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.favoriteRepo.create(userId, {
      origin,
      destination,
      routeKey,
    });
    return { ...toResponse(created), alreadySaved: false };
  }

  async remove(
    userId: string,
    id: string,
  ): Promise<RemoveFavoriteRouteResponseDto> {
    return { id, removed: await this.favoriteRepo.remove(userId, id) };
  }

  private toEndpoint(
    dto: FavoriteEndpointDto,
    field: 'origin' | 'destination',
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
      this.graphService.getGraph().indexOf(dto.stationId!) === undefined
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
}
