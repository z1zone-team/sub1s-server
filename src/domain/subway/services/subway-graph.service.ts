import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubwayGraph } from '../models/subway-graph';
import {
  ISubwayGraphRepository,
  SUBWAY_GRAPH_REPOSITORY,
} from '../ports/ISubwayGraphRepository';

@Injectable()
export class SubwayGraphService implements OnModuleInit {
  private readonly logger = new Logger(SubwayGraphService.name);
  private graph?: SubwayGraph;

  constructor(
    @Inject(SUBWAY_GRAPH_REPOSITORY)
    private readonly repository: ISubwayGraphRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const started = Date.now();
    this.graph = new SubwayGraph(await this.repository.loadGraphData());
    this.logger.log(
      `graph loaded: ${this.graph.stationCount} stations in ${Date.now() - started}ms`,
    );
  }

  getGraph(): SubwayGraph {
    if (!this.graph) throw new Error('subway graph is not loaded yet');
    return this.graph;
  }
}
