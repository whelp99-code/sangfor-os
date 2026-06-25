-- Wave 1: task_links + task_status_events (canonical work_tasks model)

CREATE TABLE IF NOT EXISTS "task_links" (
    "id" TEXT NOT NULL,
    "work_task_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'related',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "task_status_events" (
    "id" TEXT NOT NULL,
    "work_task_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_status_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_links_work_task_id_entity_type_entity_id_key"
  ON "task_links"("work_task_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "task_links_entity_type_entity_id_idx"
  ON "task_links"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "task_status_events_work_task_id_idx"
  ON "task_status_events"("work_task_id");

DO $$ BEGIN ALTER TABLE "task_links" ADD CONSTRAINT "task_links_work_task_id_fkey"
  FOREIGN KEY ("work_task_id") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "task_status_events" ADD CONSTRAINT "task_status_events_work_task_id_fkey"
  FOREIGN KEY ("work_task_id") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
