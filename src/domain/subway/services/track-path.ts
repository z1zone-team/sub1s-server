import { LatLng, decodePolyline, encodePolyline } from '../../../common/utils/polyline';

/** 역 쌍의 선로 모양 키. 정렬한 ID 쌍이고 값은 앞 역에서 뒤 역으로 가는 폴리라인이다 */
export function shapeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 경로가 지나는 역 순서(stationIds)에서 한 열차 구간의 역들만 잘라 낸다. start 뒤에서 찾고 못 찾으면 undefined다 */
export function sliceSegmentStations(
  stationIds: readonly string[],
  fromId: string,
  toId: string,
  start = 0,
): { ids: string[]; next: number } | undefined {
  const from = stationIds.indexOf(fromId, start);
  if (from < 0) return undefined;
  const to = stationIds.indexOf(toId, from);
  if (to < 0) return undefined;
  return { ids: stationIds.slice(from, to + 1), next: to };
}

const SAME = 1e-5;

/**
 * 구간이 지나는 역들을 이어 선로 모양 폴리라인으로 만든다.
 * 선로 모양이 없는 역 쌍은 두 역 좌표를 직선으로 잇고, 선로 모양이 하나도 없으면 직선뿐이라 undefined다(앱이 알아서 그린다)
 */
export function composeTrackPath(
  stationIds: readonly string[],
  shapes: Readonly<Record<string, string>>,
  coordOf: (id: string) => LatLng | undefined,
): string | undefined {
  const points: LatLng[] = [];
  let anyShape = false;
  const add = (piece: LatLng[]): void => {
    for (const p of piece) {
      const last = points[points.length - 1];
      if (last && Math.abs(last.lat - p.lat) < SAME && Math.abs(last.lng - p.lng) < SAME) continue;
      points.push(p);
    }
  };

  for (let i = 1; i < stationIds.length; i += 1) {
    const u = stationIds[i - 1];
    const v = stationIds[i];
    const encoded = shapes[shapeKey(u, v)];
    if (encoded) {
      anyShape = true;
      const piece = decodePolyline(encoded);
      add(u < v ? piece : [...piece].reverse());
      continue;
    }
    const a = coordOf(u);
    const b = coordOf(v);
    if (a && b) add([a, b]);
  }
  return anyShape && points.length >= 2 ? encodePolyline(points) : undefined;
}
