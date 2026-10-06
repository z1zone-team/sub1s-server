import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CongestionModule } from './application/congestion/congestion.module';
import { HealthModule } from './application/health/health.module';
import { RouteModule } from './application/route/route.module';
import { SubwayModule } from './domain/subway/subway.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RoutingModule } from './infra/routing/routing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    SubwayModule,
    RoutingModule,
    RouteModule,
    CongestionModule,
  ],
})
export class AppModule {}
