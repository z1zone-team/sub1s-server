ALTER TYPE "settlement_status" ADD VALUE 'PROCESSING';

ALTER TABLE "settlement_notifications"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();
