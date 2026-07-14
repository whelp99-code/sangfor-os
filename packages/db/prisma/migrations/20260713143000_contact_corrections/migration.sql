ALTER TABLE "contacts"
ADD COLUMN "archived_at" TIMESTAMP(3),
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "contacts" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE INDEX "contacts_archived_at_idx" ON "contacts"("archived_at");
