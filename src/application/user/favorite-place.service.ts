import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { toKstIso } from '../../common/utils/kst';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  FAVORITE_PLACE_LIMIT,
  FavoritePlace,
  placeKeyOf,
} from '../../domain/user/models/favorite-place';
import {
  FAVORITE_PLACE_REPOSITORY,
  IFavoritePlaceRepository,
} from '../../domain/user/ports/IFavoritePlaceRepository';
import {
  FavoritePlaceResponseDto,
  FavoritePlacesResponseDto,
  RemoveFavoritePlaceResponseDto,
  SaveFavoritePlaceRequestDto,
  SaveFavoritePlaceResponseDto,
} from './dto/favorite-place.dto';
import { toFavoriteEndpoint } from './favorite-endpoint';

const toResponse = (place: FavoritePlace): FavoritePlaceResponseDto => ({
  id: place.id,
  name: place.name,
  stationId: place.stationId,
  lat: place.lat,
  lng: place.lng,
  createdAt: toKstIso(place.createdAt),
});

@Injectable()
export class FavoritePlaceService {
  constructor(
    @Inject(FAVORITE_PLACE_REPOSITORY)
    private readonly placeRepo: IFavoritePlaceRepository,
    private readonly graphService: SubwayGraphService,
  ) {}

  async list(userId: string): Promise<FavoritePlacesResponseDto> {
    const places = await this.placeRepo.findAll(userId);
    return { places: places.map(toResponse), limit: FAVORITE_PLACE_LIMIT };
  }

  /** 같은 곳이 이미 있으면 새로 만들지 않고 그것을 돌려준다(`alreadySaved`). 가득 찼으면 409 */
  async save(
    userId: string,
    dto: SaveFavoritePlaceRequestDto,
  ): Promise<SaveFavoritePlaceResponseDto> {
    const endpoint = toFavoriteEndpoint(dto, 'place', this.graphService);
    const placeKey = placeKeyOf(endpoint);

    const existing = await this.placeRepo.findByKey(userId, placeKey);
    if (existing) return { ...toResponse(existing), alreadySaved: true };

    if ((await this.placeRepo.count(userId)) >= FAVORITE_PLACE_LIMIT) {
      throw new BusinessException(
        'FAVORITE_PLACE_LIMIT',
        `favorite places are limited to ${FAVORITE_PLACE_LIMIT}`,
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.placeRepo.create(userId, {
      ...endpoint,
      placeKey,
    });
    return { ...toResponse(created), alreadySaved: false };
  }

  async remove(
    userId: string,
    id: string,
  ): Promise<RemoveFavoritePlaceResponseDto> {
    return { id, removed: await this.placeRepo.remove(userId, id) };
  }
}
