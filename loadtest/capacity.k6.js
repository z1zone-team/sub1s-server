// CPU 용량 근거 측정(k6). 자세한 사용법은 loadtest/README.md
//
// 질문: 호스트는 1 vCPU인데 컨테이너 CPU 한도 합이 2.0이다. 실제 사용 중에 한도가 동시에 차는 일이 드문가,
//       드물지 않다면(피크를 겹치면) 어디서 한계가 오는가.
//
//   PHASE=normal  평상시 부하(경로 검색 낮은 속도 + 음성 인식 가끔)로 컨테이너 CPU 합이 1 vCPU 안에 머무는지 본다.
//   PHASE=peak    경로 검색을 올리면서 음성 인식(Whisper)을 쉬지 않고 걸어 피크를 겹친다.
//
//   k6 run --summary-export results/capacity-normal.json -e PHASE=normal -e BASE_URL=https://서버주소 loadtest/capacity.k6.js
//   k6 run --summary-export results/capacity-peak.json   -e PHASE=peak   -e BASE_URL=https://서버주소 loadtest/capacity.k6.js
//
// 음성 인식은 로그인이 필요하다. TOKEN과 AUDIO_FILE을 모두 주면 음성 시나리오가 함께 돌고, 없으면 경로 검색만 돈다.
// 환경변수(-e KEY=값):
//   BASE_URL           서버 주소(기본 http://localhost:3000)
//   PHASE              normal | peak (기본 normal)
//   DURATION_MINUTES   normal의 유지 시간(분). 기본 10
//   NORMAL_RPS         normal의 경로 검색 초당 요청 수. 기본 3
//   VOICE_EVERY_SECONDS  normal에서 음성 작업을 몇 초에 한 번 낼지. 기본 120
//   PEAK_STEPS         peak의 경로 검색 단계(초당 요청 수), 쉼표로 구분. 기본 5,10,15,20
//   STEP_SECONDS       peak에서 한 단계를 유지하는 시간(초). 기본 120
//   TOKEN              로그인 토큰(Authorization: Bearer). 값을 출력하지 않는다
//   AUDIO_FILE         음성 시료(m4a, 2MB 이하). k6 실행 위치 기준 경로
//   VOICE_TIMEOUT_SECONDS  음성 작업이 끝나기를 기다리는 최대 시간(초). 기본 60
//   SEED, DEPARTURE_AT 경로 검색 부하 테스트(route-search.k6.js)와 같다
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { randomSeed } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PHASE = __ENV.PHASE || 'normal';
const DURATION_MINUTES = Number(__ENV.DURATION_MINUTES || 10);
const NORMAL_RPS = Number(__ENV.NORMAL_RPS || 3);
const VOICE_EVERY_SECONDS = Number(__ENV.VOICE_EVERY_SECONDS || 120);
const PEAK_STEPS = (__ENV.PEAK_STEPS || '5,10,15,20').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 120);
const SEED = Number(__ENV.SEED || 1);
const DEPARTURE_AT = __ENV.DEPARTURE_AT || '2026-10-21T10:00:00+09:00';
const TOKEN = __ENV.TOKEN || '';
const VOICE_TIMEOUT_SECONDS = Number(__ENV.VOICE_TIMEOUT_SECONDS || 60);
const VOICE_ENABLED = Boolean(TOKEN && __ENV.AUDIO_FILE);

if (PHASE !== 'normal' && PHASE !== 'peak') {
  throw new Error(`PHASE는 normal 또는 peak여야 한다(받은 값: ${PHASE})`);
}

const stations = JSON.parse(open('../src/data/subway/stations.json')).filter(
  (s) => typeof s.lat === 'number' && typeof s.lng === 'number',
);
const AUDIO = VOICE_ENABLED ? open(__ENV.AUDIO_FILE, 'b') : null;

const searchDuration = new Trend('route_search_duration', true);
const serverErrorRate = new Rate('server_error_rate');
const rateLimited = new Counter('rate_limited_429');
// 음성 작업: 제출부터 COMPLETED, FAILED가 될 때까지 걸린 시간과 실패율
const voiceSeconds = new Trend('voice_job_seconds', true);
const voiceFailedRate = new Rate('voice_job_failed_rate');
const voiceBusy = new Counter('voice_job_in_progress_429');

function buildScenarios() {
  const search =
    PHASE === 'normal'
      ? {
          executor: 'constant-arrival-rate',
          rate: NORMAL_RPS,
          timeUnit: '1s',
          duration: `${DURATION_MINUTES}m`,
          preAllocatedVUs: 20,
          maxVUs: 100,
          exec: 'search',
        }
      : {
          executor: 'ramping-arrival-rate',
          startRate: 1,
          timeUnit: '1s',
          preAllocatedVUs: 50,
          maxVUs: 300,
          stages: [
            ...PEAK_STEPS.flatMap((rate) => [
              { target: rate, duration: '10s' },
              { target: rate, duration: `${STEP_SECONDS}s` },
            ]),
            { target: 0, duration: '10s' },
          ],
          exec: 'search',
        };

  const scenarios = { search };
  if (!VOICE_ENABLED) return scenarios;

  const peakSeconds = PEAK_STEPS.length * (STEP_SECONDS + 10) + 10;
  scenarios.voice =
    PHASE === 'normal'
      ? {
          executor: 'constant-arrival-rate',
          rate: 1,
          timeUnit: `${VOICE_EVERY_SECONDS}s`,
          duration: `${DURATION_MINUTES}m`,
          preAllocatedVUs: 1,
          maxVUs: 1,
          exec: 'voice',
        }
      : {
          // 쉬지 않고 이어서 낸다(사용자당 진행 중 작업은 1건이라 VU 하나가 최악의 연속 부하다)
          executor: 'constant-vus',
          vus: 1,
          duration: `${peakSeconds}s`,
          exec: 'voice',
        };
  return scenarios;
}

// 측정이 목적이라 임계값으로 멈추지 않는다. 넘었는지는 요약에서 본다
export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    route_search_duration: ['p(95)<2000'],
    server_error_rate: ['rate<0.02'],
    ...(VOICE_ENABLED ? { voice_job_failed_rate: ['rate<0.1'] } : {}),
  },
};

http.setResponseCallback(http.expectedStatuses(200, 202, 404, 429));

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
  return (Math.random() - 0.5) * 0.001;
}

function buildSearch(kind) {
  const [a, b] = pair();
  const body = { departureAt: DEPARTURE_AT };
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

export function setup() {
  for (let i = 0; i < 10; i += 1) {
    const res = http.post(`${BASE_URL}/api/v1/routes/search`, JSON.stringify(buildSearch('ids')), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '30s',
    });
    if (res.status === 200) return { startedAt: new Date().toISOString() };
  }
  exec.test.abort(`setup: ${BASE_URL}에서 경로 검색 200 응답을 받지 못했다. BASE_URL과 테스트 모드를 확인한다`);
}

// 경로 검색: 역 ID와 좌표(걷기 경로 서버 호출 포함)를 절반씩 섞는다
export function search() {
  const kind = Math.random() < 0.5 ? 'ids' : 'coords';
  const res = http.post(`${BASE_URL}/api/v1/routes/search`, JSON.stringify(buildSearch(kind)), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
    tags: { kind },
  });
  serverErrorRate.add(res.status === 0 || res.status >= 500, { kind });
  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }
  if (res.status === 200) searchDuration.add(res.timings.duration, { kind });
  check(res, { '검색 200 또는 경로 없음 404': (r) => r.status === 200 || r.status === 404 }, { kind });
}

// 음성 경로 추천: 오디오를 큐에 넣고 작업이 끝날 때까지 상태를 본다(STT는 AI 컨테이너의 Whisper가 한다)
export function voice() {
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const started = Date.now();
  const submit = http.post(
    `${BASE_URL}/api/v1/voice/jobs`,
    { file: http.file(AUDIO, 'sample.m4a', 'audio/mp4'), preferredMode: 'OPTIMAL' },
    { headers: auth, timeout: '30s', tags: { name: 'voice_submit' } },
  );

  if (submit.status === 429) {
    voiceBusy.add(1);
    sleep(5);
    return;
  }
  if (submit.status !== 202) {
    voiceFailedRate.add(true);
    serverErrorRate.add(submit.status === 0 || submit.status >= 500, { kind: 'voice' });
    sleep(5);
    return;
  }

  const jobId = submit.json('data.jobId');
  let status = 'QUEUED';
  while (Date.now() - started < VOICE_TIMEOUT_SECONDS * 1000) {
    sleep(1);
    const poll = http.get(`${BASE_URL}/api/v1/voice/jobs/${jobId}`, { headers: auth, tags: { name: 'voice_status' } });
    status = poll.status === 200 ? poll.json('data.status') : status;
    if (status === 'COMPLETED' || status === 'FAILED') break;
  }

  const elapsed = (Date.now() - started) / 1000;
  voiceSeconds.add(elapsed * 1000);
  voiceFailedRate.add(status !== 'COMPLETED');
}
