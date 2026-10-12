import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ENV_FILE_PATHS } from './common/config/env-files';
import { ArrivalModule } from './application/arrival/arrival.module';
import { CongestionModule } from './application/congestion/congestion.module';
import { FacilityModule } from './application/facility/facility.module';
import { HealthModule } from './application/health/health.module';
import { NotificationModule } from './application/notification/notification.module';
import { PlaceModule } from './application/place/place.module';
import { RankingModule } from './application/ranking/ranking.module';
import { RouteModule } from './application/route/route.module';
import { TrackingModule } from './application/tracking/tracking.module';
import { TravelModule } from './application/travel/travel.module';
import { FriendModule } from './application/friend/friend.module';
import { UserModule } from './application/user/user.module';
import { VoiceModule } from './application/voice/voice.module';
import { SubwayModule } from './domain/subway/subway.module';
import { DatabaseModule } from './infra/database/database.module';
import { AuthModule as InfraAuthModule } from './infra/auth/auth.module';
import { AuthModule as AuthAppModule } from './application/auth/auth.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RoutingModule } from './infra/routing/routing.module';
import { SecurityModule } from './infra/security/security.module';
import { WebsocketModule } from './infra/websocket/websocket.module';
import { DataUpdateBatchModule } from './infra/batch/data-update-batch.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [...ENV_FILE_PATHS],
    }),
    PrismaModule,
    DatabaseModule,
    SecurityModule,
    InfraAuthModule,
    AuthAppModule,
    HealthModule,
    SubwayModule,
    RoutingModule,
    RouteModule,
    PlaceModule,
    ArrivalModule,
    FacilityModule,
    NotificationModule,
    CongestionModule,
    WebsocketModule,
    TrackingModule,
    TravelModule,
    RankingModule,
    UserModule,
    FriendModule,
    VoiceModule,
    DataUpdateBatchModule,
  ],
})
export class AppModule {}
