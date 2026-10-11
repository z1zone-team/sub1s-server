import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PlaceKind } from '../../domain/user/models/place';
import {
  IUserPlaceRepository,
  USER_PLACE_REPOSITORY,
} from '../../domain/user/ports/IUserPlaceRepository';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import {
  PlaceResponseDto,
  PlacesResponseDto,
  RemovePlaceResponseDto,
  SavePlaceRequestDto,
} from './dto/place.dto';

@Injectable()
export class UserPlaceService {
  constructor(
    @Inject(USER_PLACE_REPOSITORY)
    private readonly placeRepo: IUserPlaceRepository,
    private readonly graphService: SubwayGraphService,
  ) {}

  async list(userId: string): Promise<PlacesResponseDto> {
    return { places: await this.placeRepo.findAll(userId) };
  }

  async save(
    userId: string,
    kind: PlaceKind,
    dto: SavePlaceRequestDto,
  ): Promise<PlaceResponseDto> {
    const hasStation = dto.stationId !== undefined;
    const hasCoords = dto.lat !== undefined && dto.lng !== undefined;

    if (!hasStation && !hasCoords) {
      throw new BusinessException(
        'INVALID_REQUEST_PAYLOAD',
        'stationId or lat and lng is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (hasStation && this.graphService.getGraph().indexOf(dto.stationId!) === undefined) {
      throw new BusinessException(
        'STATION_NOT_FOUND',
        `station id not found: ${dto.stationId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return this.placeRepo.save(userId, kind, {
      name: dto.name,
      stationId: hasStation ? dto.stationId! : null,
      lat: hasStation ? null : dto.lat!,
      lng: hasStation ? null : dto.lng!,
    });
  }

  async remove(userId: string, kind: PlaceKind): Promise<RemovePlaceResponseDto> {
    return { kind, removed: await this.placeRepo.remove(userId, kind) };
  }
}
