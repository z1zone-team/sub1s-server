import { Module } from '@nestjs/common';
import { SUBWAY_GRAPH_REPOSITORY } from '../../domain/subway/ports/ISubwayGraphRepository';
import { SubwayGraphRepository } from './repositories/subway-graph.repository';

@Module({
  providers: [
    { provide: SUBWAY_GRAPH_REPOSITORY, useClass: SubwayGraphRepository },
  ],
  exports: [SUBWAY_GRAPH_REPOSITORY],
})
export class DatabaseModule {}
