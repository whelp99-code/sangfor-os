-- CreateEnum
CREATE TYPE "deal_status" AS ENUM ('OPEN','WON','LOST','ON_HOLD','DISQUALIFIED');

-- AlterTable (additive; existing rows default to OPEN / NEW_BUILD)
ALTER TABLE "opportunities" ADD COLUMN "deal_status" "deal_status" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "opportunities" ADD COLUMN "lost_reason" text;
ALTER TABLE "opportunities" ADD COLUMN "deal_type" text DEFAULT 'NEW_BUILD';
ALTER TABLE "opportunities" ADD COLUMN "owner_id" text;

-- FK (owner_id -> users.id); User model @@map = "users"
-- TODO(oma-deferred): owner will expand to Actor union (User | TeamAgent) in a future migration
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
