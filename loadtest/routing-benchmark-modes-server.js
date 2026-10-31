// 경로 검색 요청 하나가 계산하는 모드(최적, 여유, 최소 비용, 최소 시간, 최소 도보, 최소 환승)별 탐색 CPU 시간과 그 합계를 재는 일회용 스크립트.
// routing-benchmark-server.js와 같은 방식으로 같은 이미지의 일회용 컨테이너에서 돌린다. 개인 맞춤(로그인 시)은 제외한다.
//
//   scp loadtest/routing-benchmark-modes-server.js sub1s:/tmp/
//   ssh sub1s "sudo docker run --rm --cpus 0.4 --memory 768m --network none --entrypoint node -e REPEAT=40 -e WARM_UP=20 -v /tmp/routing-benchmark-modes-server.js:/bench.js:ro ghcr.io/z1zone-team/sub1s-server:latest --expose-gc /bench.js"
//
// 마지막 행 SUM이 요청 하나의 탐색 합계다. avgMs는 CPU 사용 시간, wallAvgMs는 벽시계다.
const path = require('path');
const fs = require('fs');
const root = '/app/dist';
const { SubwayGraph } = require(path.join(root, 'domain/subway/models/subway-graph'));
const { StatisticalCongestionProvider } = require(path.join(root, 'infra/congestion/statistical-congestion.provider'));
const { DijkstraRouteEngine } = require(path.join(root, 'infra/routing/dijkstra-route.engine'));
const { AStarRouteEngine } = require(path.join(root, 'infra/routing/astar-route.engine'));

const REPEAT = Number(process.env.REPEAT || 100);
const WARM_UP = Number(process.env.WARM_UP || 30);
const QUERIES_PER_CLASS = 40;
const ALLOCATION_SAMPLE = 300;
const dir = path.join(root, 'data/subway');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));

const graph = new SubwayGraph({ stations: read('stations.json'), edges: read('edges.json'), transfers: read('transfers.json') });
const fareRule = read('fare-rules.json');
const congestion = new StatisticalCongestionProvider(read('congestion.json'));
const source = { getGraph: () => graph };
const engines = [
  ['Dijkstra', new DijkstraRouteEngine(source, congestion, fareRule)],
  ['A*', new AStarRouteEngine(source, congestion, fareRule)],
];
const departureAt = new Date('2026-10-05T08:00:00+09:00');

function queryClass(label, accept) {
  const reference = engines[0][1];
  const picked = [];
  let seed = label.length * 7919;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let attempt = 0; attempt < 20000; attempt += 1) {
    if (picked.length === QUERIES_PER_CLASS) break;
    const a = graph.station(Math.floor(next() * graph.stationCount)).id;
    const b = graph.station(Math.floor(next() * graph.stationCount)).id;
    if (a === b) continue;
    const query = { originStationId: a, destinationStationId: b, mode: 'OPTIMAL', departureAt };
    try {
      const rides = reference.findRouteWithStatsSync(query).result.segments.reduce((s, x) => s + x.stationCount, 0);
      if (accept(rides)) picked.push(query);
    } catch (e) { /* not connected */ }
  }
  return picked;
}

const classes = [
  ['short', queryClass('short', (n) => n >= 1 && n <= 5)],
  ['long', queryClass('long', (n) => n >= 15)],
];
classes.push(['all', classes.flatMap(([, q]) => q)]);

const MODES = ['OPTIMAL', 'COMFORTABLE', 'CHEAPEST', 'FASTEST', 'LEAST_WALK', 'FEWEST_TRANSFERS'];
const all = classes[2][1];
const out = [];
for (const [name, engine] of engines) {
  let perRequest = 0;
  for (const mode of MODES) {
    const qs = all.map((q) => ({ ...q, mode }));
    let ok = 0;
    for (let i = 0; i < WARM_UP; i += 1) for (const q of qs) { try { engine.findRouteWithStatsSync(q); } catch (e) {} }
    const t0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    for (let r = 0; r < REPEAT; r += 1) for (const q of qs) { try { engine.findRouteWithStatsSync(q); ok += 1; } catch (e) {} }
    const wall = Number(process.hrtime.bigint() - t0) / 1e6 / (REPEAT * qs.length);
    const cu = process.cpuUsage(c0);
    const ms = (cu.user + cu.system) / 1000 / (REPEAT * qs.length);
    out.push({ engine: name, mode, avgMs: Number(ms.toFixed(4)), wallAvgMs: Number(wall.toFixed(4)), okRate: Number((ok / (REPEAT * qs.length)).toFixed(3)) });
    perRequest += ms;
  }
  out.push({ engine: name, mode: 'SUM(요청 하나의 6개 모드)', avgMs: Number(perRequest.toFixed(4)) });
}
console.log(JSON.stringify({ node: process.version, arch: process.arch, repeat: REPEAT, rows: out }));
