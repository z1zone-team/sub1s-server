# 경로 검색 부하 테스트

`POST /api/v1/routes/search`에 요청 속도를 단계적으로 올려 서버가 어디까지 응답 시간을 유지하는지 본다. 운영 서버(서버 컨테이너 CPU 0.4코어, 메모리 768MB 제한)를 대상으로 한다.

## 준비

1. **k6 설치**(PC): `winget install k6` 또는 https://grafana.com/docs/k6/latest/set-up/install-k6/ . `k6 version`으로 확인한다.
2. **테스트 모드 켜기**(서버): 외부 API 호출과 백그라운드 작업을 끄고 nginx의 IP당 속도 제한을 푼다. `sub1s-deploy`의 `loadtest.sh`가 한다(README 6.1). 시간을 정해 두면 그 시간이 지나 자동으로 꺼진다.
   ```bash
   ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh on 90m"   # 90분 뒤 자동으로 기본 설정으로 복구
   ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh status"
   ```
3. **다른 사용자가 앱을 쓰지 않는 시간**에 한다. 테스트 모드에서는 열차 위치, 알림, 장소 검색이 동작하지 않는다.
4. 서버 상태 기록을 시작한다(선택, 권장): `ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh observe 60m"` 은 5초마다 컨테이너 CPU, 메모리, 스왑, DB 연결 수를 기록한다.

## 실행

```bash
# 스모크(1건/초 1분)만 먼저 확인
k6 run -e BASE_URL=https://서버주소 -e STEPS=1 -e SMOKE_SECONDS=60 loadtest/route-search.k6.js

# 전체 단계(1, 5, 10, 15, 20, 25건/초). 역 ID 검색
k6 run --summary-export results/ids.json -e BASE_URL=https://서버주소 loadtest/route-search.k6.js

# 좌표 검색(걷기 경로 서버 호출 포함)
k6 run --summary-export results/coords.json -e BASE_URL=https://서버주소 -e SCENARIO=coords loadtest/route-search.k6.js
```

끝나면 **바로 서버를 원래대로 돌린다**(자동 복구를 기다리지 않아도 된다).

```bash
ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh off"
```

테스트와 복구를 한 줄로 묶으면 k6가 실패하거나 중단돼도 서버가 돌아온다.

```bash
k6 run -e BASE_URL=https://서버주소 loadtest/route-search.k6.js ; ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh off"
```

## 옵션

| 환경변수 | 기본 | 뜻 |
| :--- | :--- | :--- |
| `BASE_URL` | `http://localhost:3000` | 서버 주소(경로는 `/api/v1/routes/search`를 붙인다) |
| `SCENARIO` | `ids` | `ids`(역 ID), `coords`(좌표), `mix`(절반씩) |
| `STEPS` | `1,5,10,15,20,25` | 초당 요청 수 단계 |
| `STEP_SECONDS` | `120` | 한 단계를 유지하는 시간(초) |
| `SMOKE_SECONDS` | `60` | 첫 단계 유지 시간(초) |
| `SEED` | `1` | 난수 씨앗. 같으면 같은 요청 순서로 다시 돌릴 수 있다 |
| `DEPARTURE_AT` | `2026-10-21T10:00:00+09:00` | 출발 시각. 막차, 첫차 계산이 응답을 바꾸므로 고정한다. 공휴일이면 평일로 바꾼다 |
| `ROUTE_MODE` | (없음) | `OPTIMAL`, `COMFORTABLE` 등으로 고정 |

## 중단 기준(임계값)

시작 30초 뒤부터 다음 중 하나를 넘으면 k6가 즉시 멈춘다.

- 응답 시간 p95가 **2초** 초과(`route_search_duration`, 200 응답만)
- 서버 오류(5xx, 연결 실패)가 **2%** 초과(`server_error_rate`)
- 예상 못 한 응답(`unexpected_rate`)이 **2%** 초과
- 시작 전에 보낸 요청 10개 중 200 응답이 하나도 없으면 시작하지 않는다(주소 확인)

서버 쪽에서는 사용 가능한 메모리가 500MB 아래로 내려가거나 스왑이 계속 늘면 사람이 멈춘다(`Ctrl+C`).

## 결과 읽기

- `route_search_duration`: 200 응답의 응답 시간(p50, p95, p99). `{kind:ids}`, `{kind:coords}`로 나뉜다.
- `server_error_rate`: 5xx와 연결 실패 비율.
- `rate_limited_429`: nginx가 429를 준 수. **0이어야 한다.** 0이 아니면 테스트 모드가 켜지지 않았거나 속도 제한이 남아 있는 것이다.
- `route_not_found_404`: 우리 서버가 `ROUTE_NOT_FOUND`로 답한 쌍(정상 응답으로 센다).
- `unexpected_rate`: 200, 우리 서버의 경로 없음(404), 429, 5xx가 아닌 응답의 비율. **0이어야 한다.** 0이 아니면 주소가 다른 서버를 가리키거나 요청 형식이 틀린 것이다(2%를 넘으면 10초 뒤 중단).
- `dropped_iterations`: 서버가 느려 k6가 보내지 못한 요청. 0이 아니면 그 단계에서 서버가 한계에 닿은 것이다.
- 한계 속도(초당 N건)를 구하면 "한 사람이 안내 중 평균 몇 분마다 검색하는지"로 나눠 동시에 활동하는 사용자 수를 역산한다.

## 해석할 때 알아둘 것

- 테스트 모드는 외부 API를 끄므로 공휴일 확인을 건너뛰고(평일 취급) 운행 공지가 `UNKNOWN`이다. 두 데이터는 서버 안에 캐시가 있어 영향은 작지만 결과가 실제보다 **약간 낙관적**일 수 있다.
- PC에서 보내므로 인터넷 지연이 섞인다(서버 안의 처리 시간보다 크게 보인다).
- 부하 테스트는 경로 검색만 잰다. 음성 검색(Whisper), 안내 중 웹소켓, 로그인은 따로 해야 한다.

## CPU 용량 근거 측정

호스트는 1 vCPU인데 컨테이너 CPU 한도의 합은 2.0이다(server 0.40, ai 0.60, osrm 0.30, postgres 0.30, server-mock 0.20, nginx 0.10, valkey 0.10). "한도가 동시에 차는 일이 드물다"는 짐작을 수치로 바꾸려고 두 가지를 잰다.

1. **평상시(`PHASE=normal`)**: 경로 검색을 낮은 속도로, 음성 인식을 가끔 걸었을 때 컨테이너 실사용 CPU의 합이 1 vCPU 안에 머무는가.
2. **피크 겹침(`PHASE=peak`)**: 경로 검색을 단계적으로 올리면서 음성 인식(Whisper)을 쉬지 않고 걸었을 때 어디서 한계가 오는가(응답 지연, 오류, 호스트 CPU 포화, 스왑).

스크립트는 `capacity.k6.js`(부하), `../../sub1s-deploy/loadtest.sh observe`(서버 CPU 기록), `analyze-observe.py`(집계)다.

### 준비

- 위 [준비](#준비)의 1~3과 같다(k6 설치, 테스트 모드 켜기, 사용자가 없는 시간).
- 음성 시나리오를 함께 돌리려면 로그인 토큰(`TOKEN`)과 음성 시료(`AUDIO_FILE`, m4a 2MB 이하)가 필요하다. 없으면 경로 검색만 돈다. 토큰 값은 기록이나 화면에 남기지 않는다.
- `loadtest.sh observe`가 호스트 CPU와 steal 열을 함께 기록하려면 서버의 `sub1s-deploy`에 이 변경이 반영돼 있어야 한다. 옛 버전이면 컨테이너 열만 기록된다.

### 실행

```bash
# 1) 서버: 테스트 모드와 기록 시작 (평상시 10분이면 기록 15m이면 충분)
ssh sub1s "cd ~/sub1s-deploy && ./loadtest.sh on 60m"
ssh sub1s "cd ~/sub1s-deploy && nohup ./loadtest.sh observe 15m > ~/observe-normal.tsv 2>&1 &"

# 2) PC: 평상시 부하
k6 run --summary-export results/capacity-normal.json -e PHASE=normal -e DURATION_MINUTES=10 \
  -e BASE_URL=https://서버주소 -e TOKEN=$TOKEN -e AUDIO_FILE=sample.m4a loadtest/capacity.k6.js

# 3) 기록이 끝나면 받아서 집계
scp sub1s:~/observe-normal.tsv results/
python loadtest/analyze-observe.py results/observe-normal.tsv
```

피크는 같은 순서로 `PHASE=peak`, 기록 파일은 `observe-peak.tsv`로 한다(기록 시간은 `PEAK_STEPS`와 `STEP_SECONDS`로 정해지는 시간보다 넉넉히, 기본값이면 10분 안팎이라 `15m`). 끝나면 서버를 되돌린다(`./loadtest.sh off`).

피크에서 서버가 한계를 넘으면 스왑을 쓰거나 응답이 느려질 수 있으니 처음에는 `PEAK_STEPS=5,10`처럼 낮게 시작하고 `observe`의 사용 가능 메모리 경고(500MB 미만)를 본다.

### 결과 읽기와 문서에 쓰는 법

`analyze-observe.py`가 보여 주는 것:

- 컨테이너별 평균, p95, 최대 CPU와 한도 대비 최대 비율. 한도를 넘는 컨테이너가 있으면 한도가 실제로 병목이다.
- **컨테이너 CPU 합**의 평균, p95, 최대와 호스트 1 vCPU를 넘은 기록의 비율. 평상시에 이 비율이 0에 가깝고 합의 p95가 1.0보다 충분히 작으면 "한도 합이 2.0이어도 동시에 차지 않는다"의 근거가 된다.
- 호스트 전체 CPU 사용률과 포화(95% 이상) 비율, steal. 피크에서 포화 비율이 높으면 겹쳤을 때 서로 느려진다는 근거다.
- 합이 가장 컸던 시각의 컨테이너 구성: 어떤 조합이 겹치면 한계가 오는지.

문서의 "드물다고 생각해서" 문장은 측정 결과로 바꾼다. 예: "평상시 부하(경로 검색 초당 3건, 음성 10분당 5건)에서 컨테이너 CPU 합은 평균 0.xx, p95 0.xx vCPU로 1 vCPU를 넘은 기록이 x%였고, 경로 검색 초당 N건과 음성 인식을 겹친 피크에서는 합이 최대 x.xx vCPU, 호스트 CPU 포화 x%, 경로 검색 p95 xxx ms였다."

### 해석할 때 알아둘 것

- `docker stats`의 CPU%는 코어 하나가 100%다. 합이 1.0을 넘는 기록은 컨테이너 한도가 겹쳐 호스트 1 vCPU를 나눠 쓴 구간이다(한도는 상한일 뿐 보장이 아니다).
- 음성 인식(Whisper small)은 시료 길이에 따라 CPU 시간이 달라진다. 실제 사용 길이에 가까운 시료(5~10초 발화)를 쓴다.
- 테스트 모드에서는 열차 위치 폴링과 푸시 스케줄러가 꺼져 있어 실제 서비스보다 서버 컨테이너의 평상시 CPU가 **약간 낮게** 나올 수 있다. 문서에 이 점을 함께 적는다.
- 같은 조건으로 다시 재면 결과가 조금 다르다. `SEED`를 고정하고, 근거로 쓸 때는 두 번 이상 재서 범위를 적는다.
- 웹소켓(안내 중 실시간 위치), 로그인, 랭킹 조회는 이 스크립트에 없다. 이 부하는 경로 검색과 음성 인식 대비 작다고 보지만 측정한 것은 아니다.

## 로그인 사용자 서비스 측정 (`loadtest/service/`)

k6 두 스크립트는 인증 없이 돌아 개인화 계산(선호 모델, 취향 임베딩, 이웃 보정), 안내 세션, 음성 작업 큐를 지나지 않는다. 이 묶음은 로그인한 사용자로 다음을 잰다. 결과와 해석은 sub1s-docs `SERVICE_MEASUREMENTS.md`에 있다.

| 스크립트 | 실행 위치 | 하는 일 |
| :--- | :--- | :--- |
| `gen-pairs.js` | PC(서버 저장소 루트) | 역 120쌍(씨앗 고정), 출발역의 같은 노선 이웃 역, 환승 묶음을 `pairs.json`으로 만든다 |
| `mint-session.js` | `sub1s-server` 컨테이너 | 지정한 Clerk 사용자로 측정용 세션을 만들고 40초마다 세션 토큰을 stdout으로 내보낸다. 측정 뒤 `mint-session.js revoke`로 세션을 폐기한다 |
| `measure-search-reroute.js` | `sub1s-server-mock` 컨테이너 | 같은 역 쌍을 비로그인, 로그인으로 번갈아 검색해 비교(search), 안내 시작 후 반대 방향 역 보고로 재탐색 성공을 센다(reroute) |
| `measure-voice.js` | `sub1s-server-mock` 컨테이너 | WAV 발화로 `POST /voice/jobs`를 넣고 `GET /voice/jobs/:id`가 끝날 때까지 시간을 잰다 |

- 요청은 같은 Docker 네트워크의 `http://server:3000/api/v1`로 보낸다. 인터넷과 nginx 시간은 빠지므로 k6(PC에서 인터넷 경유) 수치와 바로 비교하지 않는다. `server-mock`은 CPU 한도가 따로 있어 측정 스크립트가 서버 CPU를 쓰지 않는다
- **토큰은 화면에 찍지 않는다.** `mint-session.js`의 stdout을 측정 스크립트의 stdin으로 바로 잇는다. 운영 Clerk는 live 인스턴스라 mock 토큰이 안 되고, `CLERK_SECRET_KEY`는 서버 컨테이너 안에서만 쓴다
- 측정에 쓸 계정은 계정 주인의 동의를 받는다. 로그인 검색은 그 계정의 `user_preferences` 행(선호 벡터, 취향 임베딩)을 만들거나 고친다. 안내 세션은 서버 메모리에만 남고 이동 기록은 만들지 않는다. 음성 작업은 완료 후 10분 보관된다
- 테스트 모드(`loadtest.sh on`)는 켜지 않아도 된다. 요청은 초당 1건 남짓이다

```bash
# 1) PC: 역 쌍 만들기와 스크립트 올리기
node loadtest/service/gen-pairs.js . results/pairs.json
ssh sub1s 'sudo -n docker exec -i sub1s-server sh -c "cat > /tmp/mint-session.js"' < loadtest/service/mint-session.js
for f in measure-search-reroute.js measure-voice.js; do
  ssh sub1s "sudo -n docker exec -i sub1s-server-mock sh -c 'cat > /tmp/$f'" < loadtest/service/$f
done
ssh sub1s 'sudo -n docker exec -i sub1s-server-mock sh -c "cat > /tmp/pairs.json"' < results/pairs.json

# 2) 서버: 검색 비교와 재탐색(약 4분). USER는 Clerk 사용자 ID(user_...)
ssh sub1s 'sudo -n docker exec -i sub1s-server node /tmp/mint-session.js USER 15 2>/tmp/mint.log \
  | sudo -n docker exec -i sub1s-server-mock node /tmp/measure-search-reroute.js /tmp/pairs.json all \
  > /tmp/service-measure.json 2>/tmp/service-measure.log; \
  sudo -n docker exec sub1s-server node /tmp/mint-session.js revoke; cat /tmp/mint.log'
scp sub1s:/tmp/service-measure.json results/
```

측정이 끝나면 **반드시 `mint-session.js revoke`를 실행한다**(위 명령의 마지막 줄). ssh 한 줄로 측정하면 ssh가 닫힐 때 토큰 내보내기 프로세스가 폐기 단계 없이 끝나거나 남는다(2026-11-26 두 번 확인). `revoke`는 `/tmp/mint-session.id`에 남긴 세션을 폐기하고 남은 프로세스를 끝낸다. 출력에 `revoke <세션 ID> 200`이 있어야 한다.

음성은 발화 WAV(16kHz 모노)를 `v0.wav`, `v1.wav` ...로, 문장을 같은 순서로 `phrases.txt`에 한 줄씩 두고 폴더째 `server-mock`의 `/tmp/v/voice`에 올린 뒤 같은 방식으로 돌린다(`measure-voice.js /tmp/v/voice /tmp/v/voice/phrases.txt 2`). 2026-11-26 측정은 Windows 한국어 음성(Microsoft Heami)으로 만든 7문장을 썼다(`System.Speech`, 16kHz 16bit 모노). 개인 녹음은 서버에 올리지 않는다.
