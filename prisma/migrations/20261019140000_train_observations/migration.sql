CREATE TABLE "train_observations" (
    "id" SERIAL NOT NULL,
    "line_id" VARCHAR(10) NOT NULL,
    "train_no" VARCHAR(20) NOT NULL,
    "station_name" VARCHAR(50) NOT NULL,
    "station_id" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "destination_name" VARCHAR(50) NOT NULL,
    "is_last_train" BOOLEAN NOT NULL,
    "observed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "train_observations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_train_observations_observed" ON "train_observations"("observed_at");
CREATE INDEX "idx_train_observations_line" ON "train_observations"("line_id", "observed_at");

CREATE TABLE "train_service_daily" (
    "id" SERIAL NOT NULL,
    "service_date" VARCHAR(10) NOT NULL,
    "station_id" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "first_sec" INTEGER NOT NULL,
    "last_sec" INTEGER NOT NULL,
    "samples" INTEGER NOT NULL,

    CONSTRAINT "train_service_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_train_service_daily" ON "train_service_daily"("service_date", "station_id", "direction");
CREATE INDEX "idx_train_service_daily_station" ON "train_service_daily"("station_id", "direction");
