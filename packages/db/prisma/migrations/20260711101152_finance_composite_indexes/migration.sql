-- CreateIndex
CREATE INDEX "finance_cashflows_type_projectId_date_idx" ON "finance_cashflows"("type", "projectId", "date");

-- CreateIndex
CREATE INDEX "finance_expenses_category_isPaid_projectId_idx" ON "finance_expenses"("category", "isPaid", "projectId");

-- CreateIndex
CREATE INDEX "finance_invoices_depositStatus_projectId_idx" ON "finance_invoices"("depositStatus", "projectId");

-- CreateIndex
CREATE INDEX "finance_tax_invoices_direction_issue_date_idx" ON "finance_tax_invoices"("direction", "issue_date");
