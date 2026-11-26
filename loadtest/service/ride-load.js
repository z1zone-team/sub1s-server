// PC에서 서버 저장소 루트에서 실행한다(socket.io-client는 서버 devDependencies). 안내 중인 사용자 N명을 흉내 낸다.
// 사용자마다: 로그인 경로 검색 -> 안내 시작 -> WebSocket(/ws/subway) 연결 -> 15초마다 경로 위 다음 역 좌표로 위치 보고.
// 앱과 같다: GPS 15초 간격(GUIDE_LOCATION_INTERVAL_MS), 위치 보고 POST /routes/track/position, 알림용 소켓 1개.
// 세션 토큰은 stdin으로 받는다(mint-session.js 출력을 ssh로 파이프, 화면에 찍지 않는다). 소켓은 연결할 때의 토큰으로 인증한다.
//
// 사용: ssh sub1s '... mint-session.js USER 30' | node loadtest/service/ride-load.js <pairs.json> <단계 인원, 예: 50,100,200> [단계 초, 기본 90] > result.json
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const ORIGIN = process.env.ORIGIN || 'https://sub1s.devnoco.com';
const API = `${ORIGIN}/api/v1`;
const REPORT_MS = 15_000;
const RAMP_PER_SEC = 5; // 새 사용자를 초당 이만큼씩 들인다(경로 검색이 한꺼번에 몰리지 않게)
const [pairsFile, levelsArg, holdArg] = process.argv.slice(2);
const { pairs } = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
const levels = (levelsArg || '50,100,200').split(',').map(Number);
const holdSec = Number(holdArg || 90);
const stations = require(path.resolve('src/data/subway/stations.json'));
const coordOf = Object.fromEntries(stations.map((s) => [s.id, { lat: s.lat, lng: s.lng }]));
const log = (...a) => process.stderr.write('[ride] ' + a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null, buf = '';
process.stdin.on('data', (d) => { buf += d; const l = buf.split('\n'); buf = l.pop(); for (const x of l) if (x.trim()) token = x.trim(); });
process.stdin.on('error', () => {});

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]); };

// 단계별로 모으는 값
let window = null;
const newWindow = (riders) => ({ riders, reports: [], reportErr: 0, offRoute: 0, alerts: 0, disconnects: 0, startErr: 0 });

async function api(method, p, body) {
  const t0 = performance.now();
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ms: performance.now() - t0, json };
}

const riders = [];

async function addRider(i) {
  const p = pairs[Math.floor(rnd() * pairs.length)];
  try {
    const s = await api('POST', '/routes/search', { originStationId: p.o, destinationStationId: p.d });
    const option = (s.json?.data?.options ?? []).find((o) => o.mode === 'OPTIMAL') ?? s.json?.data?.options?.[0];
    if (!option) throw new Error('no route ' + s.status);
    const st = await api('POST', '/routes/track/start', { routeOption: option });
    const session = st.json?.data;
    if (!session?.sessionId) throw new Error('start ' + st.status);
    const queue = [session.currentStationId, ...(session.expectedRemainingStationIds ?? [])].filter((id) => coordOf[id]);
    const socket = io(`${ORIGIN}/ws/subway`, { transports: ['websocket'], auth: { token }, reconnection: true });
    socket.on('smart_alert', () => window && window.alerts++);
    socket.on('disconnect', () => window && window.disconnects++);
    const rider = { i, sessionId: session.sessionId, queue, step: 0, socket, timer: null };
    // 첫 보고 시각을 흩어 15초 동안 고르게 나눈다
    rider.timer = setTimeout(function tick() {
      report(rider).finally(() => { rider.timer = setTimeout(tick, REPORT_MS); });
    }, Math.floor(rnd() * REPORT_MS));
    riders.push(rider);
  } catch (e) {
    if (window) window.startErr++;
    log('rider start failed', i, e.message);
  }
}

async function report(rider) {
  // 끝까지 가면 처음부터 다시(같은 세션에서 남은 역을 돌며 보고만 한다)
  const id = rider.queue[Math.min(rider.step, rider.queue.length - 1)];
  rider.step = rider.step + 1 < rider.queue.length ? rider.step + 1 : rider.step;
  const c = coordOf[id];
  try {
    const r = await api('POST', '/routes/track/position', { sessionId: rider.sessionId, lat: c.lat, lng: c.lng });
    if (!window) return;
    if (r.status >= 200 && r.status < 300) {
      window.reports.push(r.ms);
      if (r.json?.data?.isOffRoute) window.offRoute++;
    } else window.reportErr++;
  } catch {
    if (window) window.reportErr++;
  }
}

(async () => {
  while (!token) await sleep(200);
  const out = { origin: ORIGIN, holdSec, startedAt: new Date().toISOString(), levels: [] };
  for (const level of levels) {
    window = newWindow(level);
    const rampStart = Date.now();
    while (riders.length < level) {
      await addRider(riders.length);
      const shouldHave = ((Date.now() - rampStart) / 1000) * RAMP_PER_SEC;
      if (riders.length > shouldHave) await sleep(1000 / RAMP_PER_SEC);
    }
    // 들어오는 동안의 값은 버리고 유지 구간만 잰다
    window = newWindow(level);
    const connectedAtStart = riders.filter((r) => r.socket.connected).length;
    await sleep(holdSec * 1000);
    const w = window;
    const summary = {
      riders: level,
      socketsConnected: riders.filter((r) => r.socket.connected).length,
      socketsAtStart: connectedAtStart,
      reports: w.reports.length,
      reportsPerSec: +(w.reports.length / holdSec).toFixed(2),
      reportErr: w.reportErr,
      offRoute: w.offRoute,
      p50: pct(w.reports, 0.5), p95: pct(w.reports, 0.95), p99: pct(w.reports, 0.99),
      max: w.reports.length ? Math.round(Math.max(...w.reports)) : null,
      alerts: w.alerts, disconnects: w.disconnects, startErr: w.startErr,
    };
    out.levels.push(summary);
    log(JSON.stringify(summary));
    const errRate = (w.reportErr) / Math.max(1, w.reports.length + w.reportErr);
    if ((summary.p95 ?? 0) > 2000 || errRate > 0.02) { out.stoppedAt = level; log('stop', level); break; }
  }
  for (const r of riders) { clearTimeout(r.timer); r.socket.close(); }
  out.endedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})().catch((e) => { log('error', e.stack); process.exit(1); });
