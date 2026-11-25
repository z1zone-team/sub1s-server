-- CreateTable
CREATE TABLE "user_favorite_places" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "place_key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "station_id" VARCHAR(30),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_favorite_places_user" ON "user_favorite_places"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_favorite_places_user_id_place_key_key" ON "user_favorite_places"("user_id", "place_key");

-- AddForeignKey
ALTER TABLE "user_favorite_places" ADD CONSTRAINT "user_favorite_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
