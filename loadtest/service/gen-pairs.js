// 서버 저장소의 역·간선 데이터로 측정용 역 쌍을 만든다(씨앗 고정). 출발역마다 같은 노선의 이웃 역(반대 방향 후보)을 붙인다.
// 사용: node loadtest/service/gen-pairs.js . pairs.json (서버 저장소 루트에서)
const path = require('path');
const fs = require('fs');
const [repo, out] = process.argv.slice(2);
const dir = path.resolve(repo, 'src/data/subway');
const stations = require(path.join(dir, 'stations.json')).filter((s) => typeof s.lat === 'number');
const edges = require(path.join(dir, 'edges.json'));
const transfers = require(path.join(dir, 'transfers.json'));
let seed = 20261126;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const neighbors = {};
for (const e of edges) {
  (neighbors[e.fromStationId] ??= new Set()).add(e.toStationId);
  (neighbors[e.toStationId] ??= new Set()).add(e.fromStationId);
}
const pairs = [];
while (pairs.length < 120) {
  const a = stations[Math.floor(rnd() * stations.length)];
  const b = stations[Math.floor(rnd() * stations.length)];
  if (a.id === b.id || a.stationName === b.stationName) continue;
  const nb = [...(neighbors[a.id] ?? [])];
  if (nb.length === 0) continue;
  pairs.push({
    o: a.id, oName: a.stationName, oLat: a.lat, oLng: a.lng,
    d: b.id, dName: b.stationName, dLat: b.lat, dLng: b.lng,
    nb,
  });
}
const names = Object.fromEntries(stations.map((s) => [s.id, s.stationName]));
// 환승으로 이어진 역(이름이 달라도 같은 역, 예: 이수와 총신대입구)은 같은 묶음 번호를 준다
const parent = {};
const find = (id) => (parent[id] === undefined || parent[id] === id ? (parent[id] = id) : (parent[id] = find(parent[id])));
for (const t of transfers) parent[find(t.fromStationId)] = find(t.toStationId);
const groups = Object.fromEntries(stations.map((s) => [s.id, find(s.id)]));
fs.writeFileSync(out, JSON.stringify({ pairs, names, groups }));
console.log('pairs', pairs.length);
