-- CreateIndex
CREATE INDEX "customers_segment_risk_score_idx" ON "customers"("segment", "risk_score");

-- CreateIndex
CREATE INDEX "opportunities_customer_id_stage_idx" ON "opportunities"("customer_id", "stage");

-- CreateIndex
CREATE INDEX "opportunities_stage_stage_entered_at_idx" ON "opportunities"("stage", "stage_entered_at");
