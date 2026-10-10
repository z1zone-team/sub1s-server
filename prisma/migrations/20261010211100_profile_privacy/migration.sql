-- CreateEnum
CREATE TYPE "ranking_visibility" AS ENUM ('PUBLIC', 'ANONYMOUS', 'PRIVATE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "name" VARCHAR(50),
ADD COLUMN     "nickname_customized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ranking_visibility" "ranking_visibility" NOT NULL DEFAULT 'PUBLIC';

UPDATE "users" SET "ranking_visibility" = 'PRIVATE' WHERE "is_ranking_public" = false;

-- 닉네임이 겹치면 가장 먼저 만든 계정만 유지하고 나머지는 id 접미사를 붙인다 (43 + 1 + 6자로 VARCHAR(50)에 맞춤)
UPDATE "users" AS u
SET "nickname" = left(u."nickname", 43) || '_' || substr(replace(u."id"::text, '-', ''), 1, 6)
FROM (
    SELECT "id", row_number() OVER (PARTITION BY lower("nickname") ORDER BY "created_at", "id") AS rn
    FROM "users"
) AS d
WHERE u."id" = d."id" AND d.rn > 1;

-- 표현식 인덱스. prisma/sql/0001_users_nickname_lower_unique.sql 참고
CREATE UNIQUE INDEX "users_nickname_lower_key" ON "users" (lower("nickname"));
