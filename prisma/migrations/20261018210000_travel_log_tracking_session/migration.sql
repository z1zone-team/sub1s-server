ALTER TABLE "travel_logs" ADD COLUMN "tracking_session_id" VARCHAR(64);

CREATE UNIQUE INDEX "travel_logs_tracking_session_id_key" ON "travel_logs"("tracking_session_id");
