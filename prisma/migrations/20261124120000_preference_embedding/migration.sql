-- 취향 문장 임베딩(AI 서버 multilingual-e5-small, 384차원)과 그 입력 해시. 이웃 선호 검색의 2단계 정렬에 쓴다
ALTER TABLE "user_preferences" ADD COLUMN "preference_embedding" vector(384), ADD COLUMN "preference_embedding_key" VARCHAR(64);
