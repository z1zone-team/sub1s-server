import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { RoutingModule } from '../../infra/routing/routing.module';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';

@Module({
  imports: [SubwayModule, RoutingModule],
  controllers: [RouteController],
  providers: [RouteService],
  exports: [RouteService],
})
export class RouteModule {}
