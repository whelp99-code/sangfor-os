-- CFO tax-invoice automation: inbound/outbound 세금계산서 fields + company settings.

-- AlterTable: new fields on finance_tax_invoices (all nullable, additive)
ALTER TABLE "finance_tax_invoices" ADD COLUMN     "buyer_ceo_name" TEXT,
ADD COLUMN     "expense_id" TEXT,
ADD COLUMN     "issue_id" TEXT,
ADD COLUMN     "item_summary" TEXT,
ADD COLUMN     "raw_xml" TEXT,
ADD COLUMN     "source_message_id" TEXT,
ADD COLUMN     "supplier_ceo_name" TEXT;

-- CreateTable: company settings singleton (holds the 사업자번호 used as decryption key)
CREATE TABLE "finance_company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "business_number" TEXT NOT NULL,
    "company_name" TEXT,
    "ceo_name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotency on NTS approval number
CREATE UNIQUE INDEX "finance_tax_invoices_issue_id_key" ON "finance_tax_invoices"("issue_id");
