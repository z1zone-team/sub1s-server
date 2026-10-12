import { Body, Controller, Delete, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiTags,
} from '@nestjs/swagger';
import { kstNowIso } from '../../common/utils/kst';
import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { ClerkAuthGuard } from '../../infra/auth/clerk-auth.guard';
import { AuthUser, CurrentUser } from '../../infra/auth/current-user.decorator';
import { MyProfileResponseDto } from './dto/my-profile-response.dto';
import {
  PreferencesResponseDto,
  UpdatePreferencesRequestDto,
} from './dto/preferences.dto';
import {
  FavoriteRouteIdParamDto,
  FavoriteRoutesResponseDto,
  RemoveFavoriteRouteResponseDto,
  SaveFavoriteRouteRequestDto,
  SaveFavoriteRouteResponseDto,
} from './dto/favorite-route.dto';
import {
  PlaceKindParamDto,
  PlaceResponseDto,
  PlacesResponseDto,
  RemovePlaceResponseDto,
  SavePlaceRequestDto,
} from './dto/place.dto';
import { UpdateProfileRequestDto } from './dto/update-profile-request.dto';
import { FavoriteRouteService } from './favorite-route.service';
import { UserPlaceService } from './user-place.service';
import { UserService } from './user.service';

@ApiTags('Users')
@ApiBearerAuth('clerk-auth')
@Controller('v1/users')
@UseGuards(ClerkAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userPlaceService: UserPlaceService,
    private readonly favoriteRouteService: FavoriteRouteService,
  ) {}

  @Patch('me')
  @ApiOperation({
    summary: '내 프로필 수정',
    description:
      '이름, 닉네임, 이동 기록 공개 범위 중 보낸 항목만 수정합니다. 하나 이상 필요합니다.',
  })
  @SwaggerResponse({ status: 200, description: '수정된 프로필' })
  @SwaggerResponse({ status: 400, description: '형식 오류 또는 수정할 항목 없음' })
  @SwaggerResponse({ status: 409, description: '이미 사용 중인 닉네임 (NICKNAME_TAKEN)' })
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileRequestDto,
  ): Promise<ApiResponse<MyProfileResponseDto>> {
    const data = await this.userService.updateProfile(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('me/preferences')
  @ApiOperation({
    summary: '내 관심 설문 조회',
    description: '설문 전이면 빈 배열을 돌려줍니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 용무와 경로 취향' })
  async getPreferences(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<PreferencesResponseDto>> {
    const data = await this.userService.getPreferences(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Put('me/preferences')
  @ApiOperation({
    summary: '내 관심 설문 저장',
    description:
      '용무와 경로 취향을 통째로 교체합니다. 각각 1개 이상이어야 하고 중복은 제거됩니다. 설문을 건너뛰면 호출하지 않습니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 용무와 경로 취향' })
  @SwaggerResponse({ status: 400, description: '빈 배열 또는 허용되지 않는 값' })
  async replacePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePreferencesRequestDto,
  ): Promise<ApiResponse<PreferencesResponseDto>> {
    const data = await this.userService.replacePreferences(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('me/places')
  @ApiOperation({
    summary: '집, 학교 즐겨찾기 조회',
    description: '저장한 종류만 돌려줍니다. 하나도 없으면 빈 배열입니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 즐겨찾기' })
  async getPlaces(@CurrentUser() user: AuthUser): Promise<ApiResponse<PlacesResponseDto>> {
    const data = await this.userPlaceService.list(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Put('me/places/:kind')
  @ApiOperation({
    summary: '집, 학교 즐겨찾기 저장',
    description:
      'HOME 또는 SCHOOL을 저장하거나 교체합니다. 역이면 stationId, 장소면 lat과 lng를 보냅니다. 둘 다 보내면 역이 우선합니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 즐겨찾기' })
  @SwaggerResponse({ status: 400, description: '형식 오류 또는 역과 좌표 둘 다 없음' })
  @SwaggerResponse({ status: 404, description: '없는 역 ID (STATION_NOT_FOUND)' })
  async savePlace(
    @CurrentUser() user: AuthUser,
    @Param() params: PlaceKindParamDto,
    @Body() dto: SavePlaceRequestDto,
  ): Promise<ApiResponse<PlaceResponseDto>> {
    const data = await this.userPlaceService.save(user.id, params.kind, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Delete('me/places/:kind')
  @ApiOperation({
    summary: '집, 학교 즐겨찾기 삭제',
    description: '없어도 200이고 removed가 false입니다.',
  })
  @SwaggerResponse({ status: 200, description: '삭제 결과' })
  async removePlace(
    @CurrentUser() user: AuthUser,
    @Param() params: PlaceKindParamDto,
  ): Promise<ApiResponse<RemovePlaceResponseDto>> {
    const data = await this.userPlaceService.remove(user.id, params.kind);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Get('me/favorites/routes')
  @ApiOperation({
    summary: '경로 즐겨찾기 조회',
    description:
      '저장한 경로(출발 → 도착)를 최근에 저장한 순서로 돌려줍니다. 하나도 없으면 빈 배열입니다. 집, 학교 즐겨찾기(`me/places`)와는 별개입니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 경로 즐겨찾기와 저장 한도' })
  async getFavoriteRoutes(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<FavoriteRoutesResponseDto>> {
    const data = await this.favoriteRouteService.list(user.id);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Put('me/favorites/routes')
  @ApiOperation({
    summary: '경로 즐겨찾기 저장',
    description:
      '출발과 도착을 저장합니다. 각각 역이면 stationId, 장소면 lat과 lng를 보냅니다(둘 다 보내면 역이 우선). 같은 경로가 이미 있으면 새로 만들지 않고 그 항목을 alreadySaved true로 돌려줍니다. 사용자당 20개까지입니다.',
  })
  @SwaggerResponse({ status: 200, description: '저장된 경로 즐겨찾기' })
  @SwaggerResponse({ status: 400, description: '형식 오류, 역과 좌표 둘 다 없음, 출발과 도착이 같음' })
  @SwaggerResponse({ status: 404, description: '없는 역 ID (STATION_NOT_FOUND)' })
  @SwaggerResponse({ status: 409, description: '저장 한도 초과 (FAVORITE_ROUTE_LIMIT)' })
  async saveFavoriteRoute(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveFavoriteRouteRequestDto,
  ): Promise<ApiResponse<SaveFavoriteRouteResponseDto>> {
    const data = await this.favoriteRouteService.save(user.id, dto);
    return { success: true, data, timestamp: kstNowIso() };
  }

  @Delete('me/favorites/routes/:id')
  @ApiOperation({
    summary: '경로 즐겨찾기 삭제',
    description: '없거나 다른 사용자의 것이어도 200이고 removed가 false입니다.',
  })
  @SwaggerResponse({ status: 200, description: '삭제 결과' })
  async removeFavoriteRoute(
    @CurrentUser() user: AuthUser,
    @Param() params: FavoriteRouteIdParamDto,
  ): Promise<ApiResponse<RemoveFavoriteRouteResponseDto>> {
    const data = await this.favoriteRouteService.remove(user.id, params.id);
    return { success: true, data, timestamp: kstNowIso() };
  }
}
