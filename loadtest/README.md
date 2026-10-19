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
