import { Module } from '@nestjs/common';
import { SubwayModule } from '../../domain/subway/subway.module';
import { RoutingModule } from '../../infra/routing/routing.module';
import { CongestionController } from './congestion.controller';
import { CongestionService } from './congestion.service';

@Module({
  imports: [SubwayModule, RoutingModule],
  controllers: [CongestionController],
  providers: [CongestionService],
  exports: [CongestionService],
})
export class CongestionModule {}
