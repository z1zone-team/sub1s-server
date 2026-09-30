import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseKricRoute } from './lib/kric';
import {
  EXCLUDED_KRIC_STATIONS,
  KRIC_LINE_TO_LINE_ID,
  OUT_DIR,
  RAW_DIR,
  StationRecord,
  distanceKm,
  equivalentNames,
  kricKey,
  loadStations,
  normalize,
  readJson,
} from './lib/subway-common';

interface Member {
  station: StationRecord;
  order: number;
  code: string;
}

export interface TopologyLink {
  lineId: string;
  fromStationId: string;
  toStationId: string;
}

// KRIC gives one ordered list per line where branches share the same order number.
// beyond this the two stations belong to disconnected sections (e.g. the two GTX-A sections)
const MAX_LINK_KM = 20;

// The KRIC order cannot express these physical connections, so they are set explicitly.
// from -> to follows the ascending direction of the loop (or branch) as it is travelled.
const ADD_LINKS: Record<string, [string, string][]> = {
  // 2호선 순환: 을지로입구 -> 시청 closes the loop (KRIC order runs 시청 -> 충정로 ... 을지로입구)
  '02': [['을지로입구', '시청']],
  // 6호선 응암순환: 구산 -> 응암 closes the loop and 새절 hangs on 응암
  '06': [
    ['구산', '응암'],
    ['응암', '새절'],
  ],
  GJ: [['신촌', '가좌']],
};
const REMOVE_LINKS: Record<string, [string, string][]> = {
  '06': [['구산', '새절']],
  // 서울역 - 신촌 branch of 경의중앙선 joins the main line at 가좌, not at 한국항공대
  GJ: [['한국항공대', '신촌']],
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function loadMembers(
  ln: string,
  lineId: string,
  stations: StationRecord[],
  excluded: string[],
): Member[] {
  const byName = new Map<string, StationRecord>();
  for (const s of stations.filter((s) => s.lineId === lineId)) {
    for (const name of equivalentNames(kricKey(s.stationName))) {
      byName.set(name, s);
    }
  }
  const rows = parseKricRoute(
    readJson<unknown>(join(RAW_DIR, `kric-route-${ln}.json`)),
  );
  const members: Member[] = [];
  for (const row of rows) {
    const key = kricKey(row.stinNm);
    if (EXCLUDED_KRIC_STATIONS.map(normalize).includes(key)) {
      excluded.push(`${lineId} ${row.stinNm}`);
      continue;
    }
    const station = byName.get(key);
    if (!station)
      throw new Error(`KRIC station not in list: ${lineId} ${row.stinNm}`);
    members.push({ station, order: row.stinConsOrdr, code: row.stinCd });
  }
  return members.sort(
    (a, b) => a.order - b.order || a.code.localeCompare(b.code),
  );
}

function buildLinks(lineId: string, members: Member[]): TopologyLink[] {
  const orders = [...new Set(members.map((m) => m.order))].sort(
    (x, y) => x - y,
  );
  const byOrder = new Map<number, Member[]>();
  for (const m of members)
    byOrder.set(m.order, [...(byOrder.get(m.order) ?? []), m]);

  const chosen = new Map<string, TopologyLink>();
  const toLink = (from: StationRecord, to: StationRecord): TopologyLink => ({
    lineId,
    fromStationId: from.id,
    toStationId: to.id,
  });

  // every station hangs on the nearest station of the previous order, which also splits branches
  for (let i = 1; i < orders.length; i += 1) {
    const previous = byOrder.get(orders[i - 1]) ?? [];
    for (const member of byOrder.get(orders[i]) ?? []) {
      let best: Member | undefined;
      let bestKm = Infinity;
      for (const candidate of previous) {
        const km = distanceKm(
          candidate.station.lat,
          candidate.station.lng,
          member.station.lat,
          member.station.lng,
        );
        if (km < bestKm) {
          best = candidate;
          bestKm = km;
        }
      }
      if (!best || bestKm > MAX_LINK_KM) continue;
      const link = toLink(best.station, member.station);
      chosen.set(pairKey(link.fromStationId, link.toStationId), link);
    }
  }

  const byKey = new Map<string, StationRecord>();
  for (const m of members) {
    for (const name of equivalentNames(kricKey(m.station.stationName))) {
      byKey.set(name, m.station);
    }
  }
  const lookup = (name: string): StationRecord => {
    const station = byKey.get(kricKey(name));
    if (!station)
      throw new Error(`override station not found: ${lineId} ${name}`);
    return station;
  };
  for (const [from, to] of REMOVE_LINKS[lineId] ?? []) {
    chosen.delete(pairKey(lookup(from).id, lookup(to).id));
  }
  for (const [from, to] of ADD_LINKS[lineId] ?? []) {
    const link = toLink(lookup(from), lookup(to));
    chosen.set(pairKey(link.fromStationId, link.toStationId), link);
  }
  return [...chosen.values()];
}

function countComponents(ids: string[], links: TopologyLink[]): number {
  const neighbors = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of links) {
    neighbors.get(l.fromStationId)?.push(l.toStationId);
    neighbors.get(l.toStationId)?.push(l.fromStationId);
  }
  const seen = new Set<string>();
  let components = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    components += 1;
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(neighbors.get(current) ?? []));
    }
  }
  return components;
}

interface SegmentJson {
  fromStationId: string;
  toStationId: string;
}

function main(): void {
  const stations = loadStations();
  const nameOf = new Map(stations.map((s) => [s.id, s.stationName]));
  const links: TopologyLink[] = [];
  const lineSeq: Record<string, number> = {};
  const excluded: string[] = [];

  for (const [ln, lineId] of Object.entries(KRIC_LINE_TO_LINE_ID)) {
    if (!existsSync(join(RAW_DIR, `kric-route-${ln}.json`))) {
      throw new Error(
        `missing data-raw/kric-route-${ln}.json (pnpm fetch:kric-raw)`,
      );
    }
    const members = loadMembers(ln, lineId, stations, excluded);
    members.forEach((m, index) => {
      lineSeq[m.station.id] = index + 1;
    });
    const lineLinks = buildLinks(lineId, members);
    links.push(...lineLinks);

    const degree = new Map<string, number>();
    for (const l of lineLinks) {
      degree.set(l.fromStationId, (degree.get(l.fromStationId) ?? 0) + 1);
      degree.set(l.toStationId, (degree.get(l.toStationId) ?? 0) + 1);
    }
    const label = (id: string): string => nameOf.get(id) ?? id;
    const junctions = [...degree]
      .filter(([, d]) => d >= 3)
      .map(([id]) => label(id));
    const ends = [...degree]
      .filter(([, d]) => d === 1)
      .map(([id]) => label(id));
    const components = countComponents(
      members.map((m) => m.station.id),
      lineLinks,
    );
    console.log(
      `${lineId}: stations=${members.length} links=${lineLinks.length} components=${components} junctions=[${junctions.join(',')}] ends=[${ends.join(',')}]`,
    );
  }

  // the measured Seoul Metro segments are independent evidence of physical adjacency
  const linkKeys = new Set(
    links.map((l) => pairKey(l.fromStationId, l.toStationId)),
  );
  const segments = readJson<SegmentJson[]>(join(OUT_DIR, 'segments.json'));
  const missing = segments.filter(
    (s) => !linkKeys.has(pairKey(s.fromStationId, s.toStationId)),
  );
  console.log(
    `measured segments confirmed by topology: ${segments.length - missing.length}/${segments.length}`,
  );
  for (const s of missing) {
    console.log(
      `  not a topology link: ${label(s.fromStationId)} - ${label(s.toStationId)}`,
    );
  }

  writeFileSync(
    join(OUT_DIR, 'line-topology.json'),
    JSON.stringify({ lineSeq, links }, null, 2) + String.fromCharCode(10),
  );
  console.log(
    `links: ${links.length}, stations numbered: ${Object.keys(lineSeq).length}`,
  );
  if (excluded.length > 0) console.log(`excluded: ${excluded.join(', ')}`);

  function label(id: string): string {
    return nameOf.get(id) ?? id;
  }
}

if (require.main === module) {
  main();
}
