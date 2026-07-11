-- AddForeignKey
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_tax_invoices" ADD CONSTRAINT "finance_tax_invoices_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
