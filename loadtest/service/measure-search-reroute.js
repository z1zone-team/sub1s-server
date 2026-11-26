// server-mock 컨테이너 안에서 실행. stdin으로 들어오는 세션 토큰(줄 단위)을 쓴다. 토큰은 출력하지 않는다.
// 사용: node measure-search-reroute.js <pairs.json> <search|reroute|all> > result.json
// search: 같은 역 쌍(역 ID 80, 좌표 20)을 비로그인과 로그인으로 번갈아 검색해 응답 시간을 비교한다(출발 시각 고정)
// reroute: 지금 시각으로 로그인 검색 -> 안내 시작 -> 출발역의 같은 노선 이웃 역(경로 밖)을 사용자 확인으로 보고 -> 재탐색 경로가
//          보고한 역(환승 묶음 기준)에서 출발해 도착역(환승 묶음 기준)에 닿으면 성공으로 센다
const fs = require('fs');
const BASE = process.env.BASE || 'http://server:3000/api/v1';
const DEPARTURE_AT = '2026-12-02T10:00:00+09:00'; // 수요일 오전 10시(평일 낮)
const [pairsFile, phase = 'all'] = process.argv.slice(2);
const { pairs, names, groups } = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
const log = (...a) => process.stderr.write('[measure] ' + a.join(' ') + '\n');

let token = null;
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) if (l.trim()) token = l.trim();
});
const waitToken = async () => { while (!token) await sleep(200); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + token;
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms, json, text: json ? undefined : text.slice(0, 200) };
}
const optionsOf = (r) => r.json?.data?.options ?? r.json?.options ?? [];
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const stats = (arr) => ({ n: arr.length, mean: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null, p50: pct(arr, 50), p95: pct(arr, 95), max: arr.length ? Math.max(...arr) : null });

async function searchPhase() {
  const rows = [];
  const list = pairs.slice(0, 100);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const kind = i < 80 ? 'ids' : 'coords';
    const body = kind === 'ids'
      ? { originStationId: p.o, destinationStationId: p.d, departureAt: DEPARTURE_AT }
      : { originLat: p.oLat + 0.002, originLng: p.oLng + 0.002, destinationLat: p.dLat - 0.002, destinationLng: p.dLng - 0.002, departureAt: DEPARTURE_AT };
    // 순서 영향을 줄이려고 번갈아 먼저 보낸다
    const order = i % 2 === 0 ? [false, true] : [true, false];
    const row = { i, kind, o: p.o, d: p.d };
    for (const auth of order) {
      const r = await call('POST', '/routes/search', body, auth);
      const opts = optionsOf(r);
      row[auth ? 'auth' : 'guest'] = { status: r.status, ms: r.ms, modes: opts.map((o) => o.mode), hasRec: !!r.json?.data?.recommendation, err: r.status >= 400 ? (r.json?.error?.code ?? r.text) : undefined };
      await sleep(700);
    }
    rows.push(row);
    if (i % 10 === 0) log('search', i, kind, row.guest.status, Math.round(row.guest.ms), row.auth.status, Math.round(row.auth.ms), row.auth.modes.includes('PERSONAL'));
  }
  const ok = (k, kind) => rows.filter((r) => r.kind === kind && r[k].status === 200).map((r) => r[k].ms);
  const summary = {};
  for (const kind of ['ids', 'coords']) {
    summary[kind] = {
      guest: stats(ok('guest', kind)),
      auth: stats(ok('auth', kind)),
      authFirst: rows.find((r) => r.kind === kind)?.auth.ms,
      authPersonal: rows.filter((r) => r.kind === kind && r.auth.modes.includes('PERSONAL')).length,
      statuses: rows.filter((r) => r.kind === kind).map((r) => `${r.guest.status}/${r.auth.status}`).reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {}),
    };
  }
  return { rows, summary };
}

async function reroutePhase() {
  const rows = [];
  const list = pairs.slice(0, 100);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const row = { i, o: p.o, d: p.d };
    // 지금 시각 기준 검색(재탐색도 지금 시각으로 검색한다)
    const s = await call('POST', '/routes/search', { originStationId: p.o, destinationStationId: p.d }, true);
    const opts = optionsOf(s);
    const option = opts.find((o) => o.mode === 'OPTIMAL') ?? opts[0];
    row.search = { status: s.status, ms: s.ms };
    if (!option) { row.result = 'no_route'; row.err = s.json?.error?.code ?? s.text; rows.push(row); continue; }
    const routeStations = new Set((option.segments ?? []).flatMap((g) => [g.fromStationId, g.toStationId]).concat(option.stationIds ?? []));
    const detected = p.nb.find((id) => !routeStations.has(id) && names[id] !== p.oName);
    if (!detected) { row.result = 'no_offroute_station'; rows.push(row); continue; }
    const st = await call('POST', '/routes/track/start', { routeOption: option, stationIds: option.stationIds }, true);
    const sessionId = st.json?.data?.sessionId;
    row.start = { status: st.status, ms: st.ms };
    if (!sessionId) { row.result = 'start_failed'; row.err = st.json?.error?.code ?? st.text; rows.push(row); continue; }
    const dv = await call('POST', '/routes/track/deviate', { sessionId, detectedStationId: detected, isUserConfirmed: true }, true);
    const data = dv.json?.data;
    const ro = data?.rerouteOption;
    const segs = ro?.segments ?? [];
    const last = segs[segs.length - 1];
    const first = segs[0];
    const same = (a, b) => groups[a] === groups[b] || names[a] === names[b];
    const endsAtDest = !!last && same(last.toStationId, p.d);
    const startsAtDetected = !!first && same(first.fromStationId, detected);
    row.detected = detected;
    row.deviate = { status: dv.status, ms: dv.ms, isOffRoute: data?.isOffRoute, reason: data?.reason, segs: segs.length, endsAtDest, startsAtDetected, err: dv.status >= 400 ? (dv.json?.error?.code ?? dv.text) : undefined };
    const ok = dv.status === 200 || dv.status === 201;
    row.result = ok && data?.isOffRoute && ro && endsAtDest && startsAtDetected ? 'success'
      : ok && data && !data.isOffRoute ? 'not_detected' : 'reroute_failed';
    rows.push(row);
    if (i % 10 === 0) log('reroute', i, row.result, Math.round(dv.ms));
    await sleep(700);
  }
  const counts = rows.reduce((m, r) => ((m[r.result] = (m[r.result] || 0) + 1), m), {});
  const deviateMs = rows.filter((r) => r.deviate && r.deviate.status < 300).map((r) => r.deviate.ms);
  return { rows, counts, deviate: stats(deviateMs) };
}

(async () => {
  await waitToken();
  log('token ready');
  const out = { startedAt: new Date().toISOString(), base: BASE, departureAt: DEPARTURE_AT };
  if (phase === 'search' || phase === 'all') out.search = await searchPhase();
  if (phase === 'reroute' || phase === 'all') out.reroute = await reroutePhase();
  out.endedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(out));
  log('done');
  process.exit(0);
})().catch((e) => { log('error', e.stack); process.exit(1); });
