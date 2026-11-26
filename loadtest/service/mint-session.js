// 서버 컨테이너(sub1s-server) 안에서 실행한다. CLERK_SECRET_KEY는 컨테이너 환경 변수를 쓰고 출력하지 않는다.
// 지정한 Clerk 사용자로 측정용 세션을 하나 만들고(sign-in token -> ticket 로그인), 40초마다 새 세션 토큰을 stdout에 한 줄씩 쓴다.
// stdout은 측정 스크립트로 파이프해야 한다. 터미널에 그대로 찍지 않는다. 진행 상황은 stderr에 id와 상태만 쓴다.
// 측정 스크립트가 끝나 파이프가 닫히거나, 정한 시간이 지나거나, 신호를 받으면 세션을 폐기한다.
//
// 사용: node mint-session.js <Clerk 사용자 ID(user_...)> [분, 기본 15]
// 예:   docker exec -i sub1s-server node /tmp/mint-session.js user_xxx 15 2>/tmp/mint.log | docker exec -i sub1s-server-mock node /tmp/measure-voice.js ...
const SECRET = process.env.CLERK_SECRET_KEY;
const FRONTEND_API = process.env.CLERK_FRONTEND_API || 'https://clerk.sub1s.devnoco.com';
const BACKEND = 'https://api.clerk.com/v1';
const HEADERS = { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };
const REFRESH_MS = 40_000; // 세션 토큰 수명(60초)보다 짧게

const [userId, minutesArg] = process.argv.slice(2);
const minutes = Number(minutesArg || 15);
const log = (...args) => process.stderr.write(`[mint] ${args.join(' ')}\n`);

let sessionId = null;
let stopped = false;
let wake = () => {};
const stop = (why) => {
  if (stopped) return;
  stopped = true;
  log('stop', why);
  wake();
};
process.stdout.on('error', () => stop('pipe closed'));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));

async function revoke() {
  if (!sessionId) return;
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/revoke`, { method: 'POST', headers: HEADERS });
  log('revoke', sessionId, res.status);
}

async function createSession() {
  const signInToken = await (
    await fetch(`${BACKEND}/sign_in_tokens`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    })
  ).json();
  if (!signInToken.token) throw new Error(`sign_in_token: ${JSON.stringify(signInToken.errors ?? {}).slice(0, 200)}`);
  log('sign_in_token', signInToken.id);

  const res = await fetch(`${FRONTEND_API}/v1/client/sign_ins?_is_native=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ strategy: 'ticket', ticket: signInToken.token }),
  });
  const body = await res.json();
  sessionId = body?.response?.created_session_id ?? null;
  log('sign_in', res.status, body?.response?.status, 'session', sessionId);
  if (!sessionId) throw new Error(`no session: ${JSON.stringify(body.errors ?? {}).slice(0, 200)}`);
}

async function main() {
  if (!SECRET) throw new Error('CLERK_SECRET_KEY가 없다(서버 컨테이너 안에서 실행)');
  if (!userId?.startsWith('user_')) throw new Error('Clerk 사용자 ID(user_...)를 준다');
  await createSession();
  const until = Date.now() + minutes * 60_000;
  while (!stopped && Date.now() < until) {
    const token = await (
      await fetch(`${BACKEND}/sessions/${sessionId}/tokens`, { method: 'POST', headers: HEADERS, body: '{}' })
    ).json();
    if (!token.jwt) {
      log('token failed', JSON.stringify(token.errors ?? {}).slice(0, 200));
      break;
    }
    const ok = process.stdout.write(`${token.jwt}\n`);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, REFRESH_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
      if (!ok) process.stdout.once('drain', () => {});
    });
  }
}

main()
  .catch((error) => log('error', error.message))
  .finally(async () => {
    await revoke().catch((error) => log('revoke failed', error.message));
    process.exit(0);
  });
