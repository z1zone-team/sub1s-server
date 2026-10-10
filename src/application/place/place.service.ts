import { Inject, Injectable } from '@nestjs/common';
import {
  ExternalPlace,
  IPlaceSearchProvider,
  PLACE_SEARCH_PROVIDER,
} from '../../domain/place/ports/IPlaceSearchProvider';
import {
  ISubwayLineRepository,
  SUBWAY_LINE_REPOSITORY,
  SubwayLineRecord,
} from '../../domain/place/ports/ISubwayLineRepository';
import {
  StationRecord,
  SubwayGraph,
} from '../../domain/subway/models/subway-graph';
import { SubwayGraphService } from '../../domain/subway/services/subway-graph.service';
import { WalkingService } from '../../domain/subway/services/walking.service';
import { PlaceSearchQueryDto } from './dto/place-search-query.dto';
import {
  PlaceSearchItemDto,
  PlaceSearchResultDto,
  StationLineDto,
  StationLookupResultDto,
  StationSearchItemDto,
} from './dto/place-search-response.dto';

// Same-named nodes closer than this are one physical station (line 5 and Gyeongui-Jungang Yangpyeong are not).
const SAME_STATION_RADIUS_KM = 0.5;
// Matches the nearest-station search radius of route search, so a listed place is always routable.
const NEAREST_STATION_RADIUS_KM = 2.5;
const MIN_PLACE_QUERY_LENGTH = 2;
// V-World category path of subway and railway station POIs (e.g. '철도시설 > 철도/지하철 > 일반철도역').
const RAILWAY_CATEGORY = '철도/지하철';
const UNKNOWN_LINE_COLOR = '#9CA3AF';
// The source data names the GTX-A node "서울" while every other line calls the same station "서울역". The source name stays
// in the data (the daily public-data diff compares against it), so only the names shown by search and lookup are corrected.
const STATION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  GA_X106: '서울역',
};

interface StationCluster {
  name: string;
  nodes: StationRecord[];
}

interface Origin {
  lat?: number;
  lng?: number;
}

@Injectable()
export class PlaceService {
  private lines = new Map<string, SubwayLineRecord>();
  private lineOrder = new Map<string, number>();
  private linesLoaded?: Promise<void>;

  constructor(
    @Inject(SUBWAY_LINE_REPOSITORY)
    private readonly lineRepository: ISubwayLineRepository,
    @Inject(PLACE_SEARCH_PROVIDER)
    private readonly placeProvider: IPlaceSearchProvider,
    private readonly graphService: SubwayGraphService,
    private readonly walkingService: WalkingService,
  ) {}

  // Lines are read on first use instead of at startup so the app boots without touching the database for them.
  // A failed read is not cached, so the next request retries.
  private ensureLines(): Promise<void> {
    this.linesLoaded ??= this.lineRepository.findAll().then(
      (lines) => {
        this.lines = new Map(lines.map((line) => [line.id, line]));
        this.lineOrder = new Map(lines.map((line, index) => [line.id, index]));
      },
      (error: unknown) => {
        this.linesLoaded = undefined;
        throw error;
      },
    );
    return this.linesLoaded;
  }

  async search(query: PlaceSearchQueryDto): Promise<PlaceSearchResultDto> {
    await this.ensureLines();
    const limit = query.limit ?? 10;
    const graph = this.graphService.getGraph();
    const rawQuery = query.q.trim();

    const stations = this.searchStations(graph, rawQuery, limit, query);
    const places = await this.searchPlaces(graph, rawQuery, limit);

    return { items: [...stations, ...places] };
  }

  // Returns one item per requested id, in request order, so the client can match items to what it stored.
  async findStations(ids: string[]): Promise<StationLookupResultDto> {
    await this.ensureLines();
    const graph = this.graphService.getGraph();
    const byNodeId = new Map<
      string,
      { node: StationRecord; cluster: StationCluster }
    >();
    for (const cluster of this.clusterStations(graph)) {
      for (const node of cluster.nodes)
        byNodeId.set(node.id, { node, cluster });
    }

    const items = [...new Set(ids)].flatMap((id) => {
      const found = byNodeId.get(id);
      return found ? [this.toStationItem(found.node, found.cluster)] : [];
    });
    return { items };
  }

  private searchStations(
    graph: SubwayGraph,
    rawQuery: string,
    limit: number,
    origin: Origin,
  ): StationSearchItemDto[] {
    const keyword = this.normalize(rawQuery);
    if (!keyword) return [];
    // "강남역" names a station, so only the exact station matches; "강남" is still a prefix search.
    const exactOnly = rawQuery.replace(/\s+/g, '').endsWith('역');

    return this.clusterStations(graph)
      .flatMap((cluster) => {
        const rank = this.matchRank(cluster.name, keyword);
        if (rank === undefined || (exactOnly && rank !== 0)) return [];
        return [{ cluster, rank }];
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          this.distanceFrom(origin, a.cluster) -
            this.distanceFrom(origin, b.cluster) ||
          a.cluster.name.length - b.cluster.name.length ||
          a.cluster.name.localeCompare(b.cluster.name, 'ko'),
      )
      .flatMap(({ cluster }) =>
        this.sortedByLine(cluster.nodes).map((node) =>
          this.toStationItem(node, cluster),
        ),
      )
      .slice(0, limit);
  }

  private async searchPlaces(
    graph: SubwayGraph,
    rawQuery: string,
    limit: number,
  ): Promise<PlaceSearchItemDto[]> {
    if (this.normalize(rawQuery).length < MIN_PLACE_QUERY_LENGTH) return [];

    const stationNames = new Set<string>();
    for (let i = 0; i < graph.stationCount; i += 1) {
      stationNames.add(this.normalize(graph.station(i).stationName));
    }

    const external = await this.placeProvider.search(rawQuery, limit);
    return this.withoutDuplicates(external)
      .filter((place) => !this.isStationPoi(place, stationNames))
      .flatMap((place) => {
        const nearest = this.walkingService.findNearestStations(
          graph,
          place.lat,
          place.lng,
          NEAREST_STATION_RADIUS_KM,
          1,
        )[0];
        if (!nearest) return [];
        const item: PlaceSearchItemDto = {
          type: 'PLACE',
          name: place.name,
          address: place.address,
          category: place.category,
          lat: place.lat,
          lng: place.lng,
          nearestStation: {
            stationId: nearest.station.id,
            name: this.displayName(nearest.station),
            walkDistanceM: Math.round(nearest.metrics.actualDistanceKm * 1000),
            walkDurationSec: nearest.metrics.durationSec,
          },
        };
        return [item];
      })
      .slice(0, limit);
  }

  private clusterStations(graph: SubwayGraph): StationCluster[] {
    const byName = new Map<string, StationCluster[]>();
    for (let i = 0; i < graph.stationCount; i += 1) {
      const node = graph.station(i);
      const name = this.displayName(node);
      const key = this.normalize(name);
      const clusters = byName.get(key) ?? [];
      const home = clusters.find(
        (cluster) =>
          this.walkingService.haversineDistanceKm(
            cluster.nodes[0].lat,
            cluster.nodes[0].lng,
            node.lat,
            node.lng,
          ) <= SAME_STATION_RADIUS_KM,
      );
      if (home) home.nodes.push(node);
      else clusters.push({ name, nodes: [node] });
      byName.set(key, clusters);
    }
    return [...byName.values()].flat();
  }

  // One row per line node, like a map app's "서울역 1호선"; `lines` lists every line of the physical station.
  private toStationItem(
    node: StationRecord,
    cluster: StationCluster,
  ): StationSearchItemDto {
    const seen = new Set<string>();
    const lines = this.sortedByLine(cluster.nodes)
      .filter((member) => {
        if (seen.has(member.lineId)) return false;
        seen.add(member.lineId);
        return true;
      })
      .map((member) => this.lineOf(member.lineId));
    return {
      type: 'STATION',
      stationId: node.id,
      name: cluster.name,
      lat: node.lat,
      lng: node.lng,
      line: this.lineOf(node.lineId),
      lines,
    };
  }

  private lineOf(lineId: string): StationLineDto {
    const line = this.lines.get(lineId);
    return {
      lineId,
      lineName: line?.lineName ?? lineId,
      colorHex: line?.colorHex ?? UNKNOWN_LINE_COLOR,
    };
  }

  private sortedByLine(nodes: readonly StationRecord[]): StationRecord[] {
    return [...nodes].sort(
      (a, b) => this.orderOf(a.lineId) - this.orderOf(b.lineId),
    );
  }

  // 0 exact, 1 prefix, 2 contains.
  private matchRank(stationName: string, keyword: string): number | undefined {
    const name = this.normalize(stationName);
    if (name === keyword) return 0;
    if (name.startsWith(keyword)) return 1;
    if (name.includes(keyword)) return 2;
    return undefined;
  }

  private distanceFrom(origin: Origin, cluster: StationCluster): number {
    if (origin.lat === undefined || origin.lng === undefined) return 0;
    const node = cluster.nodes[0];
    return this.walkingService.haversineDistanceKm(
      origin.lat,
      origin.lng,
      node.lat,
      node.lng,
    );
  }

  // The external search also returns the station itself ("강남역 2호선", or "논현" categorised as a railway station);
  // the STATION result already covers it. `stationNames` holds normalized station names.
  private isStationPoi(
    place: ExternalPlace,
    stationNames: Set<string>,
  ): boolean {
    const isRailwayPoi = place.category?.includes(RAILWAY_CATEGORY) ?? false;
    if (!isRailwayPoi && !place.name.includes('역')) return false;
    const stripped = place.name
      .replace(/\(.*?\)/g, '')
      .replace(/\s*(\d+호선|[가-힣]+선)$/, '');
    return stationNames.has(this.normalize(stripped));
  }

  // V-World can return the same place twice under different categories.
  private withoutDuplicates(places: ExternalPlace[]): ExternalPlace[] {
    const seen = new Set<string>();
    return places.filter((place) => {
      const key = `${place.name}|${place.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private displayName(station: StationRecord): string {
    return STATION_DISPLAY_NAMES[station.id] ?? station.stationName;
  }

  private orderOf(lineId: string): number {
    return this.lineOrder.get(lineId) ?? Number.MAX_SAFE_INTEGER;
  }

  private normalize(value: string): string {
    return value.replace(/\s+/g, '').replace(/역$/, '').toLowerCase();
  }
}
