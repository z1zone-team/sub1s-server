-- Baseline of the schema as it was when Prisma Migrate was introduced.
-- Production already has these tables; deploy registers this migration as applied there (it is not executed)
-- after checking that the live schema matches schema.prisma. Fresh databases (local, CI) run it as written.

-- user_preferences.preference_vector is a pgvector column
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "clerk_id" VARCHAR(128) NOT NULL,
    "nickname" VARCHAR(50) NOT NULL,
    "profile_image_url" VARCHAR(255),
    "is_ranking_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "preference_vector" vector(6),
    "preferred_mode" VARCHAR(20) NOT NULL DEFAULT 'OPTIMAL',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "subway_lines" (
    "id" VARCHAR(20) NOT NULL,
    "line_name" VARCHAR(50) NOT NULL,
    "color_hex" VARCHAR(10) NOT NULL,

    CONSTRAINT "subway_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" VARCHAR(30) NOT NULL,
    "line_id" VARCHAR(20) NOT NULL,
    "station_code" VARCHAR(10) NOT NULL,
    "line_seq" INTEGER NOT NULL,
    "station_name" VARCHAR(50) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "has_restroom" BOOLEAN NOT NULL DEFAULT true,
    "has_elevator" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_edges" (
    "id" UUID NOT NULL,
    "from_station_id" VARCHAR(30) NOT NULL,
    "to_station_id" VARCHAR(30) NOT NULL,
    "line_id" VARCHAR(20) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "is_express" BOOLEAN NOT NULL DEFAULT false,
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "route_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_edges" (
    "id" UUID NOT NULL,
    "from_station_id" VARCHAR(30) NOT NULL,
    "to_station_id" VARCHAR(30) NOT NULL,
    "walking_duration_sec" INTEGER NOT NULL,
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "recommended_doors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_stairs" BOOLEAN NOT NULL DEFAULT true,
    "has_escalator" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "transfer_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "origin_station_id" VARCHAR(30) NOT NULL,
    "dest_station_id" VARCHAR(30) NOT NULL,
    "total_distance_km" DOUBLE PRECISION NOT NULL,
    "transfer_count" INTEGER NOT NULL,
    "earned_points" INTEGER NOT NULL,
    "encrypted_route_payload" TEXT,
    "iv" VARCHAR(32),
    "auth_tag" VARCHAR(32),
    "wrapped_dek" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_scores" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_type" VARCHAR(20) NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "total_distance_km" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank_position" INTEGER,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE INDEX "idx_stations_name" ON "stations"("station_name");

-- CreateIndex
CREATE INDEX "idx_route_edges_from" ON "route_edges"("from_station_id");

-- CreateIndex
CREATE INDEX "idx_transfer_edges_from" ON "transfer_edges"("from_station_id");

-- CreateIndex
CREATE INDEX "idx_travel_logs_user" ON "travel_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_rank_scores_ranking" ON "rank_scores"("period_type", "period_key", "total_points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_period" ON "rank_scores"("user_id", "period_type", "period_key");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "subway_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_edges" ADD CONSTRAINT "route_edges_from_station_id_fkey" FOREIGN KEY ("from_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_edges" ADD CONSTRAINT "route_edges_to_station_id_fkey" FOREIGN KEY ("to_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_edges" ADD CONSTRAINT "route_edges_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "subway_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_edges" ADD CONSTRAINT "transfer_edges_from_station_id_fkey" FOREIGN KEY ("from_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_edges" ADD CONSTRAINT "transfer_edges_to_station_id_fkey" FOREIGN KEY ("to_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_logs" ADD CONSTRAINT "travel_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_logs" ADD CONSTRAINT "travel_logs_origin_station_id_fkey" FOREIGN KEY ("origin_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_logs" ADD CONSTRAINT "travel_logs_dest_station_id_fkey" FOREIGN KEY ("dest_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_scores" ADD CONSTRAINT "rank_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

