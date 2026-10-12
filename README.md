# Sub1S Server (`sub1s-server`)

수도권 지하철 경로 안내 서비스 Sub1S의 백엔드입니다. NestJS(Node.js) 위에 다익스트라 경로 엔진, 칸별 혼잡도,
실시간 주행 추적, 이동 기록과 랭킹, 음성 경로 추천(BullMQ 큐), WebSocket 게이트웨이를 올렸습니다.
설계와 현황은 [sub1s-docs](https://github.com/z1zone-team/sub1s-docs)의 `ARCHITECTURE_DESIGN.md`, API 계약은 `API_SPEC.md`에 있습니다.

## 구조

폴더 경계는 의존 방향을 뜻합니다. `application`과 `infra`는 `domain`의 포트(인터페이스)를 향하고, `domain`은 둘 다 import하지 않습니다
(`src/common/architecture-boundaries.spec.ts`가 검사합니다).

```text
src/
├── domain/        순수 모델과 포트 (subway, congestion, tracking, ranking, user, voice ...)
├── infra/         외부 기술 어댑터 (routing, database, queue, websocket, auth, place, arrival ...)
├── application/   HTTP 컨트롤러, DTO, 유스케이스 서비스 (route, tracking, travel, ranking, user, voice ...)
├── common/        공통 예외와 필터, 응답 봉투, KST 시간 유틸
├── data/subway/   정제된 정적 공공데이터 (stations, edges, transfers ...)
└── scripts/       시딩, 데이터 정제, 벤치마크
```

`DatabaseModule`과 `PrismaModule`은 `@Global()`이라 기능 모듈이 따로 import하지 않고 저장소를 포트 토큰(`USER_REPOSITORY` 등)으로 주입받습니다.

## 개발 환경

필요한 것: Node.js 20 이상(CI와 배포 이미지는 22), pnpm, PostgreSQL 16(pgvector), Valkey 7.2(음성 큐, 없어도 서버는 뜹니다).

```bash
pnpm install
cp .env.example .env            # 값을 채운다 (키는 커밋하지 않는다)
pnpm prisma generate
pnpm prisma migrate deploy      # 빈 DB에 마이그레이션 적용
pnpm seed:subway                # 지하철 그래프(역, 구간, 환승) 적재
pnpm start:dev                  # http://localhost:3000, Swagger는 /api/docs
```

주요 환경 변수는 `.env.example`에 설명이 있습니다. `NODE_ENV=production`에서는 개발용 모의 인증(`mock_` 토큰)이 막힙니다.

## 테스트

```bash
pnpm test                                       # 단위 테스트 (DB 불필요)
pnpm test:e2e --runInBand                       # e2e (아래 준비가 필요, 직렬로 실행)
pnpm test:benchmark                             # 경로 엔진 벤치마크
```

- e2e는 **실제 PostgreSQL**(마이그레이션과 `pnpm seed:subway` 적용)과 **Valkey**가 필요합니다. 음성 큐 e2e(`voice-jobs`)는 실제 Valkey와 WebSocket을 씁니다.
- 병렬로 돌리면 타임아웃으로 일부가 실패하므로 `--runInBand`로 실행합니다.
- `clerk-auth` e2e는 `CLERK_SECRET_KEY`가 있으면 실제 Clerk 세션으로 동작하고, 같은 사용자 이름이 DB에 남아 있으면 다시 돌릴 때 실패할 수 있습니다.
- CI(`.github/workflows/ci.yml`)는 Postgres와 Valkey 서비스를 띄워 타입 검사, 빌드, 단위, e2e를 실행합니다.

## 음성 경로 추천 큐

`POST /api/v1/voice/jobs`가 오디오를 `voice-route` 큐(Valkey, BullMQ)에 넣고 `202`로 응답하면, 서버 워커가 AI 서비스의 `subway-voice` 큐에 STT 작업을 보내
전사문을 받아 경로를 만들고 WebSocket(`voice_result`, `voice_failed`)으로 알립니다. 구조와 제한은 `ARCHITECTURE_DESIGN.md` 3.3절과 `API_SPEC.md` 2.6.2절을 보세요.

## DB 마이그레이션

스키마 변경은 Prisma Migrate 마이그레이션으로만 반영한다. 운영 DB에 `prisma db push`를 쓰지 않는다.

1. `prisma/schema.prisma`를 수정한다.
2. 로컬 DB에서 `pnpm prisma:migrate --name 설명`(`prisma migrate dev`)을 실행해 `prisma/migrations/<타임스탬프>_설명/migration.sql`을 만들고 함께 커밋한다. 이 명령은 임시(shadow) DB를 만들 수 있는 DB 계정이 필요하다.
   - 컬럼 삭제, NOT NULL 추가처럼 기존 데이터에 영향을 주는 변경은 `--create-only`로 SQL만 만든 뒤 데이터 이전 SQL을 직접 추가한다.
3. 스키마로 표현할 수 없는 인덱스(소문자 기준 유니크 같은 표현식 인덱스, 부분 유니크 등)는 마이그레이션 SQL에 직접 쓰고 이유와 함께 `prisma/sql/`에 남긴다. Prisma가 표현할 수 있는 것은 반드시 `schema.prisma`에 둔다 (스키마에 없는 인덱스는 `migrate dev`가 정리 대상으로 보고 삭제 마이그레이션을 만들 수 있다).
4. PR의 CI가 빈 DB에 `prisma migrate deploy`를 적용하고, 결과가 `schema.prisma`와 같은지 `prisma migrate diff --exit-code`로 검사한다. 스키마만 바꾸고 마이그레이션을 빠뜨리면 CI가 실패한다.
5. `main`에 머지되면 배포가 **서버 컨테이너를 교체하기 전에** `prisma migrate deploy`를 실행한다. 실패하면 배포가 중단되고 기존 서버가 그대로 유지된다. 배포가 겹치지 않도록 `flock`으로 하나씩 실행한다.

마이그레이션이 먼저 적용되는 동안 이전 버전 서버가 새 스키마로 잠시 동작하므로, **컬럼 추가는 한 번에, 삭제나 이름 변경은 두 번에 나눠서**(먼저 새 코드 배포, 다음 릴리스에서 삭제) 한다.

기준선 `20261010210000_init`은 Prisma Migrate 도입 시점의 스키마다. 이미 테이블이 있는 운영 DB는 첫 배포에서 `schema.prisma`와 차이가 없음을 확인한 뒤 이 기준선을 적용 완료로 등록한다(SQL은 실행하지 않음). 차이가 있으면 배포가 실패하므로 운영 DB를 `schema.prisma`에 맞춘 뒤 다시 배포한다.

## 배포

`main`에 머지되면 GitHub Actions가 이미지를 만들고 OCI에 배포합니다(`.github/workflows/deploy.yml`). 컨테이너 구성과 환경은
[sub1s-deploy](https://github.com/z1zone-team/sub1s-deploy)에 있습니다.

## 팀 규칙

이슈, 브랜치, 커밋, PR 규칙은 sub1s-docs의 `github-workflow.md`를 따릅니다. 서버 시간은 반드시 `src/common/utils/kst.ts`를 거칩니다(`kst-usage.spec.ts`가 검사).
