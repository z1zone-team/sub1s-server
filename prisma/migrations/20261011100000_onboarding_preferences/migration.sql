-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "route_prefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

