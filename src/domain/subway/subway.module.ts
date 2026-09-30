import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { SubwayGraphService } from './services/subway-graph.service';

@Module({
  imports: [DatabaseModule],
  providers: [SubwayGraphService],
  exports: [SubwayGraphService],
})
export class SubwayModule {}
