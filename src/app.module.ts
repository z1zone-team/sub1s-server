import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CongestionModule } from './application/congestion/congestion.module';
import { HealthModule } from './application/health/health.module';
import { RouteModule } from './application/route/route.module';
import { TrackingModule } from './application/tracking/tracking.module';
import { SubwayModule } from './domain/subway/subway.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RoutingModule } from './infra/routing/routing.module';
import { WebsocketModule } from './infra/websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    SubwayModule,
    RoutingModule,
    RouteModule,
    CongestionModule,
    WebsocketModule,
    TrackingModule,
  ],
})
export class AppModule {}
