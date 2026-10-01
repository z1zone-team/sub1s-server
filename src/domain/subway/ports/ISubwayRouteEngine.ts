import { RouteQuery, RouteResult } from '../models/route';

export const SUBWAY_ROUTE_ENGINE = Symbol('SUBWAY_ROUTE_ENGINE');

export interface ISubwayRouteEngine {
  // rejects with InvalidRouteQueryError, UnknownStationError or RouteNotFoundError
  findRoute(query: RouteQuery): Promise<RouteResult>;
}
