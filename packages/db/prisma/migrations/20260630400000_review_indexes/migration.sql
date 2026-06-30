-- Additive: FK support indexes for deal_qualifications and opportunities
-- No schema changes to existing columns, enums, or CFO tables.

CREATE INDEX IF NOT EXISTS "deal_qualifications_economic_buyer_id_idx" ON "deal_qualifications"("economic_buyer_id");
CREATE INDEX IF NOT EXISTS "deal_qualifications_champion_id_idx" ON "deal_qualifications"("champion_id");
CREATE INDEX IF NOT EXISTS "opportunities_owner_id_idx" ON "opportunities"("owner_id");
CREATE INDEX IF NOT EXISTS "opportunities_deal_status_idx" ON "opportunities"("deal_status");
