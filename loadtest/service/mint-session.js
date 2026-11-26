// 서버 컨테이너(sub1s-server) 안에서 실행한다. CLERK_SECRET_KEY는 컨테이너 환경 변수를 쓰고 출력하지 않는다.
//
// 1) 토큰 내보내기: 지정한 Clerk 사용자로 측정용 세션을 하나 만들고(sign-in token -> ticket 로그인), 40초마다 새 세션 토큰을
//    stdout에 한 줄씩 쓴다. stdout은 측정 스크립트로 파이프해야 한다. 터미널에 그대로 찍지 않는다.
//    만든 세션 ID는 SESSION_FILE에 남긴다. 진행 상황은 stderr에 id와 상태만 쓴다.
//    node mint-session.js <Clerk 사용자 ID(user_...)> [분, 기본 15]
// 2) 폐기: 측정이 끝나면 꼭 실행한다. SESSION_FILE의 세션을 폐기하고, 남아 있는 토큰 내보내기 프로세스를 끝낸다.
//    ssh 한 줄로 측정하면 ssh가 닫힐 때 1)의 프로세스가 폐기 단계 없이 끝나거나 남는다(2026-11-26 두 번 확인)
//    node mint-session.js revoke
//
// 예: docker exec -i sub1s-server node /tmp/mint-session.js user_xxx 15 2>/tmp/mint.log \
//       | docker exec -i sub1s-server-mock node /tmp/measure-voice.js ... ; docker exec sub1s-server node /tmp/mint-session.js revoke
const fs = require('fs');

const SECRET = process.env.CLERK_SECRET_KEY;
const FRONTEND_API = process.env.CLERK_FRONTEND_API || 'https://clerk.sub1s.devnoco.com';
const BACKEND = 'https://api.clerk.com/v1';
const HEADERS = { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };
const REFRESH_MS = 40_000; // 세션 토큰 수명(60초)보다 짧게
const SESSION_FILE = '/tmp/mint-session.id';

const log = (...args) => process.stderr.write(`[mint] ${args.join(' ')}\n`);

async function revokeSession(sessionId) {
  const res = await fetch(`${BACKEND}/sessions/${sessionId}/revoke`, { method: 'POST', headers: HEADERS });
  log('revoke', sessionId, res.status);
  return res.ok;
}

/** SESSION_FILE에 남은 세션을 폐기하고, 남은 토큰 내보내기 프로세스를 끝낸다 */
async function revokeCommand() {
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
      if (cmd[0] === 'node' && cmd.some((a) => a.endsWith('mint-session.js')) && cmd.includes('revoke') === false) {
        process.kill(Number(entry), 'SIGKILL');
        log('killed', entry);
      }
    } catch {
      // 사라진 프로세스
    }
  }
  if (!fs.existsSync(SESSION_FILE)) {
    log('no session file');
    return;
  }
  const ids = fs.readFileSync(SESSION_FILE, 'utf8').split('\n').filter(Boolean);
  for (const id of ids) await revokeSession(id);
  fs.unlinkSync(SESSION_FILE);
}

async function createSession(userId) {
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
  const sessionId = body?.response?.created_session_id ?? null;
  log('sign_in', res.status, body?.response?.status, 'session', sessionId);
  if (!sessionId) throw new Error(`no session: ${JSON.stringify(body.errors ?? {}).slice(0, 200)}`);
  // 폐기 명령이 찾을 수 있게 먼저 남긴다(이 프로세스가 폐기 전에 끝나도 남는다)
  fs.appendFileSync(SESSION_FILE, `${sessionId}\n`);
  return sessionId;
}

async function mintCommand(userId, minutes) {
  if (!userId?.startsWith('user_')) throw new Error('Clerk 사용자 ID(user_...) 또는 revoke를 준다');
  const sessionId = await createSession(userId);
  let stopped = false;
  process.stdout.on('error', () => (stopped = true));
  const until = Date.now() + minutes * 60_000;
  try {
    while (!stopped && Date.now() < until) {
      const token = await (
        await fetch(`${BACKEND}/sessions/${sessionId}/tokens`, { method: 'POST', headers: HEADERS, body: '{}' })
      ).json();
      if (!token.jwt) {
        log('token failed', JSON.stringify(token.errors ?? {}).slice(0, 200));
        break;
      }
      process.stdout.write(`${token.jwt}\n`);
      await new Promise((resolve) => setTimeout(resolve, REFRESH_MS));
    }
  } finally {
    // 정해진 시간이 끝나 여기까지 오면 직접 폐기한다. 강제로 끝나면 revoke 명령이 한다
    if (await revokeSession(sessionId).catch(() => false)) {
      const left = fs.readFileSync(SESSION_FILE, 'utf8').split('\n').filter((id) => id && id !== sessionId);
      if (left.length) fs.writeFileSync(SESSION_FILE, `${left.join('\n')}\n`);
      else fs.unlinkSync(SESSION_FILE);
    }
  }
}

async function main() {
  if (!SECRET) throw new Error('CLERK_SECRET_KEY가 없다(서버 컨테이너 안에서 실행)');
  const [command, minutesArg] = process.argv.slice(2);
  if (command === 'revoke') return revokeCommand();
  return mintCommand(command, Number(minutesArg || 15));
}

main()
  .catch((error) => log('error', error.message))
  .finally(() => process.exit(0));
