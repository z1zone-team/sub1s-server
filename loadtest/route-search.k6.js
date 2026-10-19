// 경로 검색 부하 테스트(k6). 자세한 사용법은 loadtest/README.md
//
//   k6 run --summary-export results/route-search.json -e BASE_URL=https://서버주소 loadtest/route-search.k6.js
//
// 요청 속도를 고정해서(ramping-arrival-rate) 서버가 느려져도 요청을 쌓아 보내므로 서버가 감당하는 지점이 그대로 보인다.
// 환경변수(-e KEY=값):
//   BASE_URL        서버 주소(기본 http://localhost:3000)
//   SCENARIO        ids(역 ID), coords(좌표, 걷기 경로 서버 포함), mix(절반씩). 기본 ids
//   STEPS           초당 요청 수 단계, 쉼표로 구분. 기본 1,5,10,15,20,25
//   STEP_SECONDS    한 단계를 유지하는 시간(초). 기본 120 (첫 단계는 SMOKE_SECONDS)
//   SMOKE_SECONDS   첫 단계(스모크) 유지 시간(초). 기본 60
//   SEED            난수 씨앗. 같은 값이면 같은 요청 순서로 다시 돌릴 수 있다. 기본 1
//   DEPARTURE_AT    출발 시각(ISO). 막차, 첫차 계산 때문에 고정한다. 기본 아래 상수
//   ROUTE_MODE      routeMode를 고정하고 싶을 때(OPTIMAL, COMFORTABLE 등)
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { randomSeed } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SCENARIO = __ENV.SCENARIO || 'ids';
const STEPS = (__ENV.STEPS || '1,5,10,15,20,25').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 120);
const SMOKE_SECONDS = Number(__ENV.SMOKE_SECONDS || 60);
const SEED = Number(__ENV.SEED || 1);
// 수요일 오전 10시(평일 낮). 날짜가 지나도 시간표는 요일 기준이라 계속 쓸 수 있지만 공휴일이면 바꾼다
const DEPARTURE_AT = __ENV.DEPARTURE_AT || '2026-10-21T10:00:00+09:00';
const ROUTE_MODE = __ENV.ROUTE_MODE || '';

const stations = JSON.parse(open('../src/data/subway/stations.json')).filter(
  (s) => typeof s.lat === 'number' && typeof s.lng === 'number',
);

// 지표: 404(경로 없음)는 정상 응답으로, 429(속도 제한)는 따로 센다. 서버 오류만 중단 기준에 쓴다
const searchDuration = new Trend('route_search_duration', true);
const serverErrorRate = new Rate('server_error_rate');
const okRate = new Rate('route_ok_rate');
const rateLimited = new Counter('rate_limited_429');
const notFound = new Counter('route_not_found_404');
// 200, 우리 서버의 ROUTE_NOT_FOUND(404), 429, 5xx 중 어느 것도 아닌 응답. 주소가 틀렸거나 요청 형식이 틀렸다는 뜻이다
const unexpectedRate = new Rate('unexpected_rate');

function stage(target, seconds) {
  return [
    { target, duration: '10s' },
    { target, duration: `${seconds}s` },
  ];
}

const stages = [];
STEPS.forEach((rate, i) => stages.push(...stage(rate, i === 0 ? SMOKE_SECONDS : STEP_SECONDS)));
stages.push({ target: 0, duration: '10s' });

export const options = {
  scenarios: {
    route_search: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages,
    },
  },
  // 중단 기준: 응답 p95가 2초를 넘거나 서버 오류율이 2%를 넘으면 즉시 멈춘다(30초 뒤부터 판단)
  thresholds: {
    route_search_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '30s' }],
    server_error_rate: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '30s' }],
    unexpected_rate: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '10s' }],
    'route_search_duration{kind:ids}': ['p(95)<2000'],
    'route_search_duration{kind:coords}': ['p(95)<2000'],
  },
};

http.setResponseCallback(http.expectedStatuses(200, 404, 429));

const isRouteNotFound = (res) => res.status === 404 && String(res.body).includes('ROUTE_NOT_FOUND');

randomSeed(SEED);

function pick() {
  return stations[Math.floor(Math.random() * stations.length)];
}

function pair() {
  for (let i = 0; i < 20; i += 1) {
    const a = pick();
    const b = pick();
    if (a.id !== b.id && a.stationName !== b.stationName) return [a, b];
  }
  return [stations[0], stations[1]];
}

function jitter() {
  return (Math.random() - 0.5) * 0.001; // 약 50m
}

function build(kind) {
  const [a, b] = pair();
  const body = { departureAt: DEPARTURE_AT };
  if (ROUTE_MODE) body.routeMode = ROUTE_MODE;
  if (kind === 'coords') {
    body.originLat = a.lat + jitter();
    body.originLng = a.lng + jitter();
    body.destinationLat = b.lat + jitter();
    body.destinationLng = b.lng + jitter();
  } else {
    body.originStationId = a.id;
    body.destinationStationId = b.id;
  }
  return body;
}

function chooseKind() {
  if (SCENARIO === 'coords') return 'coords';
  if (SCENARIO === 'mix') return Math.random() < 0.5 ? 'ids' : 'coords';
  return 'ids';
}

const params = { headers: { 'Content-Type': 'application/json' }, timeout: '30s' };

// 시작 전에 여러 쌍을 보내 보고, 200과 options가 실제로 나오는 응답이 하나도 없으면 바로 중단한다.
// (주소나 요청 형식이 틀린 채로 몇 분 돌리지 않게. 다른 서버가 404를 돌려줘도 통과시키지 않는다)
export function setup() {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const res = http.post(`${BASE_URL}/api/v1/routes/search`, JSON.stringify(build(SCENARIO === 'coords' ? 'coords' : 'ids')), params);
    last = res;
    if (res.status === 200) {
      const json = res.json();
      const options = (json && (json.options || (json.data && json.data.options))) || [];
      if (Array.isArray(options) && options.length > 0) return { startedAt: new Date().toISOString() };
    }
  }
  exec.test.abort(
    `setup: ${BASE_URL}에서 경로 검색 200 응답을 받지 못했다(마지막 응답 ${last && last.status}). BASE_URL과 요청 형식을 확인한다: ${String(last && last.body).slice(0, 200)}`,
  );
}

export default function () {
  const kind = chooseKind();
  const res = http.post(`${BASE_URL}/api/v1/routes/search`, JSON.stringify(build(kind)), {
    ...params,
    tags: { kind },
  });

  const serverError = res.status === 0 || res.status >= 500;
  serverErrorRate.add(serverError, { kind });

  const expected = res.status === 200 || res.status === 429 || isRouteNotFound(res) || serverError;
  unexpectedRate.add(!expected, { kind });

  if (res.status === 429) {
    rateLimited.add(1, { kind });
    return;
  }
  if (isRouteNotFound(res)) {
    notFound.add(1, { kind });
    return;
  }
  if (!expected) return;

  let valid = false;
  if (res.status === 200) {
    searchDuration.add(res.timings.duration, { kind });
    const json = res.json();
    const options = (json && (json.options || (json.data && json.data.options))) || [];
    valid = Array.isArray(options) && options.length > 0;
  }
  okRate.add(valid, { kind });
  check(res, { '200 응답': (r) => r.status === 200 }, { kind });
}
