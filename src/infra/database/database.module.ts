import { Global, Module } from '@nestjs/common';
import { SUBWAY_GRAPH_REPOSITORY } from '../../domain/subway/ports/ISubwayGraphRepository';
import { SUBWAY_LINE_REPOSITORY } from '../../domain/place/ports/ISubwayLineRepository';
import {
  NOTIFICATION_SETTINGS_REPOSITORY,
  PUSH_TOKEN_REPOSITORY,
  SETTLEMENT_LOG_REPOSITORY,
} from '../../domain/notification/ports/notification-ports';
import { FAVORITE_ROUTE_REPOSITORY } from '../../domain/user/ports/IFavoriteRouteRepository';
import { USER_PLACE_REPOSITORY } from '../../domain/user/ports/IUserPlaceRepository';
import { FRIEND_REPOSITORY } from '../../domain/friend/ports/IFriendRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { RANK_SCORE_REPOSITORY } from '../../domain/ranking/ports/IRankScoreRepository';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { PrismaModule } from '../prisma/prisma.module';
import { SubwayGraphRepository } from './repositories/subway-graph.repository';
import { SubwayLineRepository } from './repositories/subway-line.repository';
import { UserRepository } from './repositories/user.repository';
import { FavoriteRouteRepository } from './repositories/favorite-route.repository';
import { UserPlaceRepository } from './repositories/user-place.repository';
import { RankScoreRepository } from './repositories/rank-score.repository';
import { FriendRepository } from './repositories/friend.repository';
import { NotificationSettingsRepository } from './repositories/notification-settings.repository';
import { PushTokenRepository } from './repositories/push-token.repository';
import { SettlementLogRepository } from './repositories/settlement-log.repository';
import { TravelLogRepository } from './repositories/travel-log.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: SUBWAY_GRAPH_REPOSITORY, useClass: SubwayGraphRepository },
    { provide: SUBWAY_LINE_REPOSITORY, useClass: SubwayLineRepository },
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: USER_PLACE_REPOSITORY, useClass: UserPlaceRepository },
    { provide: FAVORITE_ROUTE_REPOSITORY, useClass: FavoriteRouteRepository },
    { provide: RANK_SCORE_REPOSITORY, useClass: RankScoreRepository },
    { provide: TRAVEL_LOG_REPOSITORY, useClass: TravelLogRepository },
    { provide: FRIEND_REPOSITORY, useClass: FriendRepository },
    { provide: PUSH_TOKEN_REPOSITORY, useClass: PushTokenRepository },
    {
      provide: NOTIFICATION_SETTINGS_REPOSITORY,
      useClass: NotificationSettingsRepository,
    },
    { provide: SETTLEMENT_LOG_REPOSITORY, useClass: SettlementLogRepository },
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
  exports: [
    SUBWAY_GRAPH_REPOSITORY,
    SUBWAY_LINE_REPOSITORY,
    USER_REPOSITORY,
    USER_PLACE_REPOSITORY,
    FAVORITE_ROUTE_REPOSITORY,
    RANK_SCORE_REPOSITORY,
    TRAVEL_LOG_REPOSITORY,
    FRIEND_REPOSITORY,
    PUSH_TOKEN_REPOSITORY,
    NOTIFICATION_SETTINGS_REPOSITORY,
    SETTLEMENT_LOG_REPOSITORY,
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
})
export class DatabaseModule {}
