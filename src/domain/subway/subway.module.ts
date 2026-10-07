import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { SubwayGraphService } from './services/subway-graph.service';
import { WalkingService } from './services/walking.service';

@Module({
  imports: [DatabaseModule],
  providers: [SubwayGraphService, WalkingService],
  exports: [SubwayGraphService, WalkingService],
})
export class SubwayModule {}
