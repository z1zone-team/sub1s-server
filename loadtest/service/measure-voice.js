// server-mock 컨테이너 안에서 실행. stdin의 세션 토큰으로 음성 작업을 넣고 완료까지 걸린 시간을 잰다.
// 사용: node measure-voice.js <wav 폴더> <phrases.txt> <반복 수> > result.json
// wav 폴더의 v0.wav, v1.wav ...는 phrases.txt의 0, 1 ...번째 줄 문장이다. 발화 하나씩 차례로 넣는다(사용자당 진행 중 작업 1건)
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://server:3000/api/v1';
const [dir, phrasesFile, repeatArg] = process.argv.slice(2);
const repeat = Number(repeatArg || 2);
const phrases = fs.readFileSync(phrasesFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const log = (...a) => process.stderr.write('[voice] ' + a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = null, buf = '';
process.stdin.on('data', (d) => { buf += d; const l = buf.split('\n'); buf = l.pop(); for (const x of l) if (x.trim()) token = x.trim(); });
// 명지대역 근처(현재 위치 출발 문장용)
const HERE = { lat: 37.2382, lng: 127.1903 };

async function runOne(file, phrase) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(dir, file))], { type: 'audio/wav' }), file);
  fd.append('lat', String(HERE.lat));
  fd.append('lng', String(HERE.lng));
  const t0 = performance.now();
  const sub = await fetch(BASE + '/voice/jobs', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const sj = await sub.json().catch(() => null);
  const submitMs = performance.now() - t0;
  const jobId = sj?.data?.jobId;
  if (!jobId) return { file, phrase, submitStatus: sub.status, err: sj?.error?.code ?? JSON.stringify(sj).slice(0, 200) };
  let last = null, firstProcessingMs = null;
  while (performance.now() - t0 < 120_000) {
    await sleep(250);
    const r = await fetch(BASE + '/voice/jobs/' + jobId, { headers: { Authorization: 'Bearer ' + token } });
    last = (await r.json().catch(() => null))?.data;
    if (last?.status === 'PROCESSING' && firstProcessingMs === null) firstProcessingMs = performance.now() - t0;
    if (last?.status === 'COMPLETED' || last?.status === 'FAILED') break;
  }
  const totalMs = performance.now() - t0;
  const res = last?.result;
  return {
    file, phrase, submitStatus: sub.status, submitMs, firstProcessingMs, totalMs, status: last?.status,
    kind: res?.kind, transcript: res?.transcript, intent: res?.interpretedIntent,
    route: res?.recommendedRoute ? { mode: res.recommendedRoute.mode, from: res.recommendedRoute.segments?.[0]?.fromStationName, to: res.recommendedRoute.segments?.at(-1)?.toStationName } : undefined,
    candidates: res?.candidates?.slice(0, 3).map((c) => c.name),
    error: last?.error,
  };
}

(async () => {
  while (!token) await sleep(200);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
  const rows = [];
  for (let k = 0; k < repeat; k++) {
    for (const f of files) {
      const idx = Number(f.match(/\d+/)[0]);
      const row = await runOne(f, phrases[idx]);
      row.round = k;
      rows.push(row);
      log(f, k, row.status, Math.round(row.totalMs), row.kind, row.transcript);
      await sleep(1500);
    }
  }
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), rows }));
  log('done');
  process.exit(0);
})().catch((e) => { log('error', e.stack); process.exit(1); });
