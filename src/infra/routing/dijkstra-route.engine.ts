import { Injectable } from '@nestjs/common';
import { MultiCriteriaRouteEngine } from './multi-criteria-route.engine';

export {
  FARE_RULE,
  SUBWAY_GRAPH_SOURCE,
  SubwayGraphSource,
} from './multi-criteria-route.engine';

// Multi-criteria Dijkstra (ADR-001): no heuristic, every station is expanded in order of its cost.
@Injectable()
export class DijkstraRouteEngine extends MultiCriteriaRouteEngine {
  protected heuristic(): undefined {
    return undefined;
  }
}
