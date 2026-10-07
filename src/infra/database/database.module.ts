import { Global, Module } from '@nestjs/common';
import { SUBWAY_GRAPH_REPOSITORY } from '../../domain/subway/ports/ISubwayGraphRepository';
import { USER_REPOSITORY } from '../../domain/user/ports/IUserRepository';
import { RANK_SCORE_REPOSITORY } from '../../domain/ranking/ports/IRankScoreRepository';
import { TRAVEL_LOG_REPOSITORY } from '../../domain/travel/ports/ITravelLogRepository';
import { PrismaModule } from '../prisma/prisma.module';
import { SubwayGraphRepository } from './repositories/subway-graph.repository';
import { UserRepository } from './repositories/user.repository';
import { RankScoreRepository } from './repositories/rank-score.repository';
import { TravelLogRepository } from './repositories/travel-log.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: SUBWAY_GRAPH_REPOSITORY, useClass: SubwayGraphRepository },
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: RANK_SCORE_REPOSITORY, useClass: RankScoreRepository },
    { provide: TRAVEL_LOG_REPOSITORY, useClass: TravelLogRepository },
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
  exports: [
    SUBWAY_GRAPH_REPOSITORY,
    USER_REPOSITORY,
    RANK_SCORE_REPOSITORY,
    TRAVEL_LOG_REPOSITORY,
    SubwayGraphRepository,
    UserRepository,
    RankScoreRepository,
    TravelLogRepository,
  ],
})
export class DatabaseModule {}
