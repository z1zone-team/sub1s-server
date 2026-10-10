-- schema.prisma로 표현할 수 없는 SQL. 만드는 마이그레이션에 붙여 넣는다.
-- 표현식 인덱스는 Prisma가 드리프트로 보지 않아 이렇게 둬도 안전하다.

-- users.nickname은 대소문자 구분 없이 유일 (20261010211100_profile_privacy)
CREATE UNIQUE INDEX users_nickname_lower_key ON users (lower(nickname));
