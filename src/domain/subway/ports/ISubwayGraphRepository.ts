import { GraphData } from '../models/subway-graph';

export const SUBWAY_GRAPH_REPOSITORY = Symbol('SUBWAY_GRAPH_REPOSITORY');

export interface ISubwayGraphRepository {
  loadGraphData(): Promise<GraphData>;
}
