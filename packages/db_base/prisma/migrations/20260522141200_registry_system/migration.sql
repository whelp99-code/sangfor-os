-- DropIndex
DROP INDEX IF EXISTS "layout_slots_slot_key_key";

-- Create module_registry first
CREATE TABLE "module_registry" (
    "id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "dependency_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_registry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "module_registry_module_key_key" ON "module_registry"("module_key");

-- Backfill modules referenced by existing blocks
INSERT INTO "module_registry" ("id", "module_key", "display_name")
SELECT DISTINCT
  'mod_' || "module_key",
  "module_key",
  initcap(replace("module_key", '-', ' '))
FROM "block_registry"
ON CONFLICT ("module_key") DO NOTHING;

INSERT INTO "module_registry" ("id", "module_key", "display_name")
VALUES
  ('mod_dashboard', 'dashboard', 'Dashboard Module'),
  ('mod_registry_admin', 'registry-admin', 'Registry Admin Module')
ON CONFLICT ("module_key") DO NOTHING;

-- connector_registry columns (table may be empty)
ALTER TABLE "connector_registry"
  ADD COLUMN IF NOT EXISTS "connector_type" TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS "display_name" TEXT NOT NULL DEFAULT 'Connector',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

ALTER TABLE "connector_registry"
  ALTER COLUMN "connector_type" DROP DEFAULT,
  ALTER COLUMN "display_name" DROP DEFAULT;

-- layout_slots: add nullable columns, backfill, enforce NOT NULL
ALTER TABLE "layout_slots"
  ADD COLUMN IF NOT EXISTS "page_key" TEXT,
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "layout_slots" SET "page_key" = 'legacy' WHERE "page_key" IS NULL;

ALTER TABLE "layout_slots" ALTER COLUMN "page_key" SET NOT NULL;

-- node_registry
CREATE TABLE "node_registry" (
    "id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "node_registry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "node_registry_node_key_key" ON "node_registry"("node_key");
CREATE INDEX "node_registry_module_key_idx" ON "node_registry"("module_key");

CREATE INDEX "block_registry_module_key_idx" ON "block_registry"("module_key");
CREATE INDEX "layout_slots_page_key_sort_order_idx" ON "layout_slots"("page_key", "sort_order");
CREATE UNIQUE INDEX "layout_slots_page_key_slot_key_key" ON "layout_slots"("page_key", "slot_key");

ALTER TABLE "block_registry"
  ADD CONSTRAINT "block_registry_module_key_fkey"
  FOREIGN KEY ("module_key") REFERENCES "module_registry"("module_key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "node_registry"
  ADD CONSTRAINT "node_registry_module_key_fkey"
  FOREIGN KEY ("module_key") REFERENCES "module_registry"("module_key")
  ON DELETE RESTRICT ON UPDATE CASCADE;
