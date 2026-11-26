// server-mock 컨테이너 안에서 실행. 경로 검색에 일정한 속도로 요청을 보내(열린 부하, 응답을 기다리지 않음)
// 비로그인과 로그인(개인화 포함)의 한계를 같은 역 쌍으로 비교한다. stdin으로 mint-session.js의 세션 토큰을 받는다(출력하지 않음).
//
// 사용: node load-search-auth.js <pairs.json> <guest-ids|auth-ids|auth-coords|guest-coords> <초당 단계, 예: 5,10,15> [단계 초, 기본 45] > result.json
// 단계마다 p95가 2초를 넘거나 서버 오류(5xx, 연결 실패)가 2%를 넘으면 다음 단계로 가지 않는다(LOAD_TEST.md와 같은 기준)
const fs = require('fs');
const BASE = process.env.BASE || 'http://server:3000/api/v1';
const DEPARTURE_AT = '2026-12-02T10:00:00+09:00';
const MAX_INFLIGHT = 300;
const [pairsFile, scenario, stepsArg, stepSecArg] = process.argv.slice(2);
const { pairs } = JSON.parse(fs.readFileSync(pairsFile, 'utf8'));
const steps = (stepsArg || '5,10,15,20,25').split(',').map(Number);
const stepSec = Number(stepSecArg || 45);
const auth = scenario.startsWith('auth');
const coords = scenario.endsWith('coords');
const log = (...a) => process.stderr.write('[load] ' + a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null, buf = '';
process.stdin.on('data', (d) => { buf += d; const l = buf.split('\n'); buf = l.pop(); for (const x of l) if (x.trim()) token = x.trim(); });
process.stdin.on('error', () => {});

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function body() {
  const p = pairs[Math.floor(rnd() * pairs.length)];
  const j = () => (rnd() - 0.5) * 0.004;
  return coords
    ? { originLat: p.oLat + j(), originLng: p.oLng + j(), destinationLat: p.dLat + j(), destinationLng: p.dLng + j(), departureAt: DEPARTURE_AT }
    : { originStationId: p.o, destinationStationId: p.d, departureAt: DEPARTURE_AT };
}

const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]); };

async function runStep(rate) {
  const results = [];
  let inflight = 0, dropped = 0;
  const interval = 1000 / rate;
  const start = performance.now();
  let n = 0;
  const pending = [];
  while (performance.now() - start < stepSec * 1000) {
    const due = start + n * interval;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    n++;
    if (inflight >= MAX_INFLIGHT) { dropped++; continue; }
    inflight++;
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + token;
    const t0 = performance.now();
    pending.push(
      fetch(BASE + '/routes/search', { method: 'POST', headers, body: JSON.stringify(body()), signal: AbortSignal.timeout(30000) })
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          const personal = !!json?.data?.options?.some((o) => o.mode === 'PERSONAL');
          results.push({ ms: performance.now() - t0, status: res.status, personal });
        })
        .catch(() => results.push({ ms: performance.now() - t0, status: 0 }))
        .finally(() => inflight--)
    );
  }
  await Promise.all(pending);
  const ok = results.filter((r) => r.status === 200).map((r) => r.ms);
  const serverErr = results.filter((r) => r.status === 0 || r.status >= 500).length;
  const other = results.filter((r) => r.status !== 200 && r.status !== 0 && r.status < 500 && r.status !== 404).length;
  const summary = {
    rate, sent: results.length, ok: ok.length, notFound: results.filter((r) => r.status === 404).length,
    serverErr, other, dropped, personal: results.filter((r) => r.personal).length,
    mean: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null,
    p50: pct(ok, 0.5), p95: pct(ok, 0.95), p99: pct(ok, 0.99), max: ok.length ? Math.round(Math.max(...ok)) : null,
  };
  log(JSON.stringify(summary));
  return summary;
}

(async () => {
  if (auth) while (!token) await sleep(200);
  const out = { scenario, stepSec, startedAt: new Date().toISOString(), steps: [] };
  for (const rate of steps) {
    const s = await runStep(rate);
    out.steps.push(s);
    const errRate = s.sent ? (s.serverErr + s.other) / s.sent : 0;
    if ((s.p95 ?? 0) > 2000 || errRate > 0.02 || s.dropped > 0) {
      out.stoppedAt = rate;
      log('stop', rate, 'p95', s.p95, 'err', errRate.toFixed(3), 'dropped', s.dropped);
      break;
    }
    await sleep(10000); // 단계 사이에 서버가 가라앉게
  }
  out.endedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})().catch((e) => { log('error', e.stack); process.exit(1); });
