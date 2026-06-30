-- Additive: BANT + 2 (Economic Buyer + Champion contact refs)
-- FK target confirmed: Contact model @@map = "contacts"
ALTER TABLE "deal_qualifications" ADD COLUMN "economic_buyer_id" text;
ALTER TABLE "deal_qualifications" ADD COLUMN "champion_id" text;

ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_economic_buyer_id_fkey"
  FOREIGN KEY ("economic_buyer_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_champion_id_fkey"
  FOREIGN KEY ("champion_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
