-- AlterTable
ALTER TABLE "finance_expenses" ADD COLUMN     "engagement_id" TEXT;

-- AlterTable
ALTER TABLE "finance_invoices" ADD COLUMN     "engagement_id" TEXT;

-- AlterTable
ALTER TABLE "finance_tax_invoices" ADD COLUMN     "engagement_id" TEXT;

-- CreateIndex
CREATE INDEX "finance_expenses_engagement_id_idx" ON "finance_expenses"("engagement_id");

-- CreateIndex
CREATE INDEX "finance_invoices_engagement_id_idx" ON "finance_invoices"("engagement_id");

-- CreateIndex
CREATE INDEX "finance_tax_invoices_engagement_id_idx" ON "finance_tax_invoices"("engagement_id");

