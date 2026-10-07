import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CongestionModule } from './application/congestion/congestion.module';
import { HealthModule } from './application/health/health.module';
import { RankingModule } from './application/ranking/ranking.module';
import { RouteModule } from './application/route/route.module';
import { TrackingModule } from './application/tracking/tracking.module';
import { TravelModule } from './application/travel/travel.module';
import { VoiceModule } from './application/voice/voice.module';
import { SubwayModule } from './domain/subway/subway.module';
import { DatabaseModule } from './infra/database/database.module';
import { AuthModule as InfraAuthModule } from './infra/auth/auth.module';
import { AuthModule as AuthAppModule } from './application/auth/auth.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RoutingModule } from './infra/routing/routing.module';
import { SecurityModule } from './infra/security/security.module';
import { WebsocketModule } from './infra/websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    DatabaseModule,
    SecurityModule,
    InfraAuthModule,
    AuthAppModule,
    HealthModule,
    SubwayModule,
    RoutingModule,
    RouteModule,
    CongestionModule,
    WebsocketModule,
    TrackingModule,
    TravelModule,
    RankingModule,
    VoiceModule,
  ],
})
export class AppModule {}
