-- AlterTable
ALTER TABLE "llm_calls" ADD COLUMN     "caller" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN     "success" BOOLEAN NOT NULL DEFAULT true;
