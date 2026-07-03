-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "probability_override" DOUBLE PRECISION,
ADD COLUMN     "stage_entered_at" TIMESTAMP(3);
