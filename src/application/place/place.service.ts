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

const SAME_STATION_RADIUS_KM = 0.5;
// 경로 탐색의 최근접역 반경과 같아서 목록의 장소는 항상 경로 탐색이 된다
const NEAREST_STATION_RADIUS_KM = 2.5;
const MIN_PLACE_QUERY_LENGTH = 2;
const RAILWAY_CATEGORY = '철도/지하철';
const UNKNOWN_LINE_COLOR = '#9CA3AF';
// 원본 데이터에서 GTX-A 노드만 '서울'이다. 변경 감지 배치가 원본 이름과 비교하므로 데이터는 두고 표시 이름만 보정한다
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

  // 앱 시작 시 DB를 읽지 않도록 첫 요청 때 불러오고, 실패하면 다음 요청에서 다시 시도한다
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

  // 0 정확 일치, 1 앞부분 일치, 2 포함
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

  // 외부 검색이 역 자체도 돌려주므로("강남역 2호선", 철도역으로 분류된 "논현") STATION 결과와 겹치는 것을 거른다
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
