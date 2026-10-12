import { Module } from '@nestjs/common';
import { SubwayGraphService } from './services/subway-graph.service';
import { WalkingService } from './services/walking.service';

@Module({
  providers: [SubwayGraphService, WalkingService],
  exports: [SubwayGraphService, WalkingService],
})
export class SubwayModule {}
