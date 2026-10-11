-- CreateEnum
CREATE TYPE "place_kind" AS ENUM ('HOME', 'SCHOOL');

-- CreateTable
CREATE TABLE "user_places" (
    "user_id" UUID NOT NULL,
    "kind" "place_kind" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "station_id" VARCHAR(30),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_places_pkey" PRIMARY KEY ("user_id","kind")
);

-- AddForeignKey
ALTER TABLE "user_places" ADD CONSTRAINT "user_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
