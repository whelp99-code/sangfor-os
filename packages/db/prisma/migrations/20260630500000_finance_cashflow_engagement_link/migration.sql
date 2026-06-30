-- AlterTable
ALTER TABLE "finance_cashflows" ADD COLUMN     "engagement_id" TEXT;

-- CreateIndex
CREATE INDEX "finance_cashflows_engagement_id_idx" ON "finance_cashflows"("engagement_id");
