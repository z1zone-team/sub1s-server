import { Global, Module } from '@nestjs/common';
import { SUBWAY_GRAPH_REPOSITORY } from '../../domain/subway/ports/ISubwayGraphRepository';
import { SUBWAY_LINE_REPOSITORY } from '../../domain/place/ports/ISubwayLineRepository';
import { FRIEND_REPOSITORY } from '../../domain/friend/ports/IFriendRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { RANK_SCORE_REPOSITORY } from '../../domain/ranking/ports/IRankScoreRepository';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { PrismaModule } from '../prisma/prisma.module';
import { SubwayGraphRepository } from './repositories/subway-graph.repository';
import { SubwayLineRepository } from './repositories/subway-line.repository';
import { UserRepository } from './repositories/user.repository';
import { RankScoreRepository } from './repositories/rank-score.repository';
import { FriendRepository } from './repositories/friend.repository';
import { TravelLogRepository } from './repositories/travel-log.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: SUBWAY_GRAPH_REPOSITORY, useClass: SubwayGraphRepository },
    { provide: SUBWAY_LINE_REPOSITORY, useClass: SubwayLineRepository },
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: RANK_SCORE_REPOSITORY, useClass: RankScoreRepository },
    { provide: TRAVEL_LOG_REPOSITORY, useClass: TravelLogRepository },
    { provide: FRIEND_REPOSITORY, useClass: FriendRepository },
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
  exports: [
    SUBWAY_GRAPH_REPOSITORY,
    SUBWAY_LINE_REPOSITORY,
    USER_REPOSITORY,
    RANK_SCORE_REPOSITORY,
    TRAVEL_LOG_REPOSITORY,
    FRIEND_REPOSITORY,
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
})
export class DatabaseModule {}
