import { Global, Module } from '@nestjs/common';
import { SUBWAY_GRAPH_REPOSITORY } from '../../domain/subway/ports/ISubwayGraphRepository';
import { SUBWAY_LINE_REPOSITORY } from '../../domain/place/ports/ISubwayLineRepository';
import {
  NOTIFICATION_SETTINGS_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  SETTLEMENT_LOG_REPOSITORY,
} from '../../domain/notification/ports/notification-ports';
import { FAVORITE_ROUTE_REPOSITORY } from '../../domain/user/ports/IFavoriteRouteRepository';
import { FAVORITE_PLACE_REPOSITORY } from '../../domain/user/ports/IFavoritePlaceRepository';
import { USER_PLACE_REPOSITORY } from '../../domain/user/ports/IUserPlaceRepository';
import { FRIEND_REPOSITORY } from '../../domain/friend/ports/IFriendRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { RANK_SCORE_REPOSITORY } from '../../domain/ranking/ports/IRankScoreRepository';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { TRAIN_OBSERVATION_REPOSITORY } from '../../domain/train-position/ports/ITrainObservationRepository';
import { TrainObservationRepository } from './repositories/train-observation.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { SubwayGraphRepository } from './repositories/subway-graph.repository';
import { SubwayLineRepository } from './repositories/subway-line.repository';
import { UserRepository } from './repositories/user.repository';
import { FavoriteRouteRepository } from './repositories/favorite-route.repository';
import { FavoritePlaceRepository } from './repositories/favorite-place.repository';
import { UserPlaceRepository } from './repositories/user-place.repository';
import { RankScoreRepository } from './repositories/rank-score.repository';
import { FriendRepository } from './repositories/friend.repository';
import { NotificationSettingsRepository } from './repositories/notification-settings.repository';
import { PushTokenRepository } from './repositories/push-token.repository';
import { SettlementLogRepository } from './repositories/settlement-log.repository';
import { TravelLogRepository } from './repositories/travel-log.repository';

/**
 * 전역 모듈 정책: `PrismaModule`과 `DatabaseModule`은 거의 모든 기능이 쓰는 기반이라 `@Global()`이다.
 * 그래서 기능 모듈은 이 둘을 따로 import하지 않고 저장소를 포트 토큰(`USER_REPOSITORY` 등)으로 주입받는다.
 * 구체 저장소 클래스는 export하지 않는다. 도메인 모듈(`domain/*`)은 이 모듈을 import하지 않는다
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: SUBWAY_GRAPH_REPOSITORY, useClass: SubwayGraphRepository },
    { provide: SUBWAY_LINE_REPOSITORY, useClass: SubwayLineRepository },
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: USER_PLACE_REPOSITORY, useClass: UserPlaceRepository },
    { provide: FAVORITE_ROUTE_REPOSITORY, useClass: FavoriteRouteRepository },
    { provide: FAVORITE_PLACE_REPOSITORY, useClass: FavoritePlaceRepository },
    { provide: RANK_SCORE_REPOSITORY, useClass: RankScoreRepository },
    { provide: TRAVEL_LOG_REPOSITORY, useClass: TravelLogRepository },
    { provide: FRIEND_REPOSITORY, useClass: FriendRepository },
    { provide: PUSH_TOKEN_REPOSITORY, useClass: PushTokenRepository },
    {
      provide: NOTIFICATION_SETTINGS_REPOSITORY,
      useClass: NotificationSettingsRepository,
    },
    { provide: SETTLEMENT_LOG_REPOSITORY, useClass: SettlementLogRepository },
    { provide: TRAIN_OBSERVATION_REPOSITORY, useClass: TrainObservationRepository },
  ],
  exports: [
    SUBWAY_GRAPH_REPOSITORY,
    SUBWAY_LINE_REPOSITORY,
    USER_REPOSITORY,
    USER_PLACE_REPOSITORY,
    FAVORITE_ROUTE_REPOSITORY,
    FAVORITE_PLACE_REPOSITORY,
    RANK_SCORE_REPOSITORY,
    TRAVEL_LOG_REPOSITORY,
    FRIEND_REPOSITORY,
    PUSH_TOKEN_REPOSITORY,
    NOTIFICATION_SETTINGS_REPOSITORY,
    SETTLEMENT_LOG_REPOSITORY,
    TRAIN_OBSERVATION_REPOSITORY,
  ],
})
export class DatabaseModule {}
