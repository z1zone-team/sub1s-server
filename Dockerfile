FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl && \
    corepack enable && \
    corepack prepare pnpm@9 --activate

# 프로덕션 실행에 필요한 설정 파일 복사
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# 프로덕션 의존성만 설치 및 Prisma Client 자동 생성
RUN pnpm install --prod --frozen-lockfile

# 사전 컴파일된 빌드 산출물 복사
COPY dist ./dist

# 보안을 위해 비루트(node) 사용자로 실행
USER node

EXPOSE 3000

CMD ["node", "dist/main"]
