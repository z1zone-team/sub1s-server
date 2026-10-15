ALTER TABLE "user_preferences" ADD COLUMN "preference_vector_v2" vector(10), ADD COLUMN "preference_model_v2" JSONB;
ALTER TABLE "travel_logs" ADD COLUMN "choice_snapshot" JSONB;
