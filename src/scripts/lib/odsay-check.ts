import { stationKey } from './kakao-check';

export interface OdsayStation {
  stationName: string;
}

export interface OdsaySubPath {
  trafficType: number;
  lane?: { name?: string }[];
  passStopList?: { stations?: OdsayStation[] };
}

export interface OdsayPath {
  info?: { payment?: number; totalTime?: number };
  subPath?: OdsaySubPath[];
}

export interface RideSummary {
  line: string;
  stations: string[];
}

export interface RouteSummary {
  rides: RideSummary[];
  transfers: number;
  fare?: number;
  minutes?: number;
}

export interface TopologyVerdict {
  unknownStations: string[];
  brokenLinks: string[];
}

// Only the first (best) path is compared. Walking legs (trafficType 3) are dropped.
export function summarize(path: OdsayPath): RouteSummary {
  const rides = (path.subPath ?? [])
    .filter((sub) => sub.trafficType === 1)
    .map((sub) => ({
      line: sub.lane?.[0]?.name ?? '?',
      stations: (sub.passStopList?.stations ?? []).map((s) =>
        stationKey(s.stationName),
      ),
    }));
  return {
    rides,
    transfers: Math.max(rides.length - 1, 0),
    fare: path.info?.payment,
    minutes: path.info?.totalTime,
  };
}

// undirected name pair of two adjacent stations
export function adjacencyKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

// Every consecutive pair inside one ride must be a link in our topology.
export function checkTopology(
  summary: RouteSummary,
  knownNames: Set<string>,
  links: Set<string>,
): TopologyVerdict {
  const unknown = new Set<string>();
  const broken: string[] = [];
  for (const ride of summary.rides) {
    ride.stations.forEach((name, i) => {
      if (!knownNames.has(name)) unknown.add(name);
      const next = ride.stations[i + 1];
      if (next && !links.has(adjacencyKey(name, next))) {
        broken.push(`${name}-${next}`);
      }
    });
  }
  return { unknownStations: [...unknown], brokenLinks: broken };
}
