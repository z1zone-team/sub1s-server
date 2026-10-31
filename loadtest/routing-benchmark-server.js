// 서버 이미지의 컴파일된 엔진으로 다익스트라와 A*를 재는 일회용 스크립트. benchmark-routing.spec.ts와 같은 방식
// (같은 난수, 질의 선택, 웜업 후 반복 평균)이다. 서버 컨테이너는 건드리지 않고 같은 이미지의 일회용 컨테이너에서 돌린다.
// 시간은 프로세스의 CPU 사용 시간(avgMs)이다. CPU 0.4코어 제한 아래의 벽시계(wallAvgMs)는 대기 시간이 섞여 약 2.5배 부풀려진다.
//
//   scp loadtest/routing-benchmark-server.js sub1s:/tmp/
//   ssh sub1s "sudo docker run --rm --cpus 0.4 --memory 768m --network none --entrypoint node -e REPEAT=100 -e WARM_UP=30 -v /tmp/routing-benchmark-server.js:/bench.js:ro ghcr.io/z1zone-team/sub1s-server:latest --expose-gc /bench.js"
//
// 한 줄 JSON(rows: 모드, 질의 종류, 엔진별 평균 ms, 방문 역, 완화 간선)을 출력한다. costMismatches가 0이어야 한다.
// 사용자가 없는 시간에 돌리고, 끝나면 /tmp의 복사본을 지운다.
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

const rows = [];
let mismatches = 0;
for (const mode of ['OPTIMAL', 'COMFORTABLE']) {
  for (const [label, queries] of classes) {
    const withMode = queries.map((q) => ({ ...q, mode }));
    for (const q of withMode) {
      const d = engines[0][1].findRouteWithStatsSync(q).stats.cost;
      const a = engines[1][1].findRouteWithStatsSync(q).stats.cost;
      if (Math.abs(d - a) > 1e-6) mismatches += 1;
    }
    for (const [name, engine] of engines) {
      for (let i = 0; i < WARM_UP; i += 1) for (const q of withMode) engine.findRouteWithStatsSync(q);
      let visited = 0, relaxed = 0;
      for (const q of withMode) { const { stats } = engine.findRouteWithStatsSync(q); visited += stats.visitedNodes; relaxed += stats.relaxedEdges; }
      const t0 = process.hrtime.bigint();
      const c0 = process.cpuUsage();
      for (let r = 0; r < REPEAT; r += 1) for (const q of withMode) engine.findRouteWithStatsSync(q);
      const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const cu = process.cpuUsage(c0);
      const ms = (cu.user + cu.system) / 1000;
      let heap = 'n/a';
      if (global.gc) {
        global.gc();
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < ALLOCATION_SAMPLE; i += 1) engine.findRouteWithStatsSync(withMode[i % withMode.length]);
        heap = Math.round((process.memoryUsage().heapUsed - before) / 1024 / ALLOCATION_SAMPLE);
      }
      rows.push({ mode, queryClass: label, engine: name, queries: withMode.length, avgMs: Number((ms / (REPEAT * withMode.length)).toFixed(4)), wallAvgMs: Number((wallMs / (REPEAT * withMode.length)).toFixed(4)),
        avgVisited: Number((visited / withMode.length).toFixed(1)), avgRelaxed: Number((relaxed / withMode.length).toFixed(1)), heapKb: heap });
    }
  }
}
console.log(JSON.stringify({ node: process.version, arch: process.arch, stations: graph.stationCount, repeat: REPEAT, warmUp: WARM_UP, costMismatches: mismatches, rows }));
