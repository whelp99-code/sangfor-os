-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "risk_score" DOUBLE PRECISION DEFAULT 0.5,
ADD COLUMN     "segment" TEXT DEFAULT 'UNCLASSIFIED';

-- AlterTable
ALTER TABLE "deal_registrations" ALTER COLUMN "updated_at" DROP DEFAULT;
