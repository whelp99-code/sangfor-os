-- Phase 12 Customer / Partner Core + WorkTask foundation

CREATE TABLE IF NOT EXISTS "customers" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "partners" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partner_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "contacts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "partner_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_partner_links" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'reseller',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_partner_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_activity_logs" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "work_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMP(3),
    "customer_id" TEXT,
    "partner_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customers_project_id_name_idx" ON "customers"("project_id", "name");
CREATE INDEX IF NOT EXISTS "partners_project_id_name_idx" ON "partners"("project_id", "name");
CREATE INDEX IF NOT EXISTS "contacts_customer_id_idx" ON "contacts"("customer_id");
CREATE INDEX IF NOT EXISTS "contacts_partner_id_idx" ON "contacts"("partner_id");
CREATE INDEX IF NOT EXISTS "contacts_email_idx" ON "contacts"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_partner_links_customer_id_partner_id_key" ON "customer_partner_links"("customer_id", "partner_id");
CREATE INDEX IF NOT EXISTS "customer_activity_logs_customer_id_idx" ON "customer_activity_logs"("customer_id");
CREATE INDEX IF NOT EXISTS "work_tasks_project_id_status_idx" ON "work_tasks"("project_id", "status");
CREATE INDEX IF NOT EXISTS "work_tasks_project_id_due_at_idx" ON "work_tasks"("project_id", "due_at");

DO $$ BEGIN ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "contacts" ADD CONSTRAINT "contacts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "customer_partner_links" ADD CONSTRAINT "customer_partner_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "customer_partner_links" ADD CONSTRAINT "customer_partner_links_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "customer_activity_logs" ADD CONSTRAINT "customer_activity_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
