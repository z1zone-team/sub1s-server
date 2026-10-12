-- CreateTable
CREATE TABLE "user_favorite_routes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route_key" VARCHAR(120) NOT NULL,
    "origin_name" VARCHAR(100) NOT NULL,
    "origin_station_id" VARCHAR(30),
    "origin_lat" DOUBLE PRECISION,
    "origin_lng" DOUBLE PRECISION,
    "destination_name" VARCHAR(100) NOT NULL,
    "destination_station_id" VARCHAR(30),
    "destination_lat" DOUBLE PRECISION,
    "destination_lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_favorite_routes_user" ON "user_favorite_routes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_routes_user_id_route_key_key" ON "user_favorite_routes"("user_id", "route_key");

-- AddForeignKey
ALTER TABLE "user_favorite_routes" ADD CONSTRAINT "user_favorite_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

