# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# 패키지 매니저 및 Prisma 정의 파일 복사
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# 빌드 의존성 설치 및 Prisma Client 생성
RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

# 소스코드 복사 및 NestJS 빌드
COPY . .
RUN pnpm build

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9 --activate

# 프로덕션 실행에 필요한 설정 파일 복사
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# 프로덕션 의존성만 설치 및 Prisma Client 생성
RUN pnpm install --prod --frozen-lockfile
RUN pnpm prisma generate

# 빌드 산출물 및 데이터 에셋 복사
COPY --from=builder /app/dist ./dist

# 보안을 위해 비루트(node) 사용자로 실행
USER node

EXPOSE 3000

CMD ["node", "dist/main"]
