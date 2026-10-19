export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OsmWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

export interface OsmRailwaysFile {
  fetchedAt: string;
  endpoint: string;
  bbox: Bbox;
  ways: OsmWay[];
}

// OSM(ODbL) 데이터: 출처 표시(© OpenStreetMap contributors)가 필요하다
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** 역 좌표의 바깥 경계에 여유를 더한 영역 */
export function bboxOf(points: { lat: number; lng: number }[], marginDeg = 0.05): Bbox {
  if (points.length === 0) throw new Error('no points');
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats) - marginDeg,
    west: Math.min(...lngs) - marginDeg,
    north: Math.max(...lats) + marginDeg,
    east: Math.max(...lngs) + marginDeg,
  };
}

/** 큰 영역을 한 번에 요청하면 공개 서버가 실패해서 stepDeg 크기의 칸으로 나눈다 */
export function splitBbox(bbox: Bbox, stepDeg: number): Bbox[] {
  const cells: Bbox[] = [];
  for (let south = bbox.south; south < bbox.north; south += stepDeg) {
    for (let west = bbox.west; west < bbox.east; west += stepDeg) {
      cells.push({
        south,
        west,
        north: Math.min(south + stepDeg, bbox.north),
        east: Math.min(west + stepDeg, bbox.east),
      });
    }
  }
  return cells;
}

/** 역이 하나도 없는 칸(바다, 산)은 선로도 필요 없으니 요청하지 않는다 */
export function cellsNearPoints(cells: Bbox[], points: { lat: number; lng: number }[], marginDeg = 0.03): Bbox[] {
  return cells.filter((cell) =>
    points.some(
      (p) =>
        p.lat >= cell.south - marginDeg &&
        p.lat <= cell.north + marginDeg &&
        p.lng >= cell.west - marginDeg &&
        p.lng <= cell.east + marginDeg,
    ),
  );
}

/** 칸 경계에 걸친 선로는 두 번 오므로 id로 하나만 남긴다 */
export function dedupeWays(ways: OsmWay[]): OsmWay[] {
  return [...new Map(ways.map((way) => [way.id, way])).values()];
}

/** 운행 선로만(기지, 측선, 연결선 등 service 태그가 붙은 것은 뺀다) */
export function buildOverpassQuery(bbox: Bbox): string {
  const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return [
    '[out:json][timeout:300][maxsize:536870912];',
    `way["railway"~"^(subway|rail|light_rail)$"][!"service"](${area});`,
    'out geom tags;',
  ].join('\n');
}

/** 선로가 없는 칸(바다, 산)은 빈 배열이 정상이다 */
export function parseOverpass(body: unknown): OsmWay[] {
  const elements = (body as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) throw new Error('unexpected Overpass response');
  return (elements as Partial<OsmWay>[]).filter(
    (el): el is OsmWay => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2,
  );
}
