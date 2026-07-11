-- CreateTable
CREATE TABLE "agent_playbooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "description" TEXT,
    "allow_unsafe" BOOLEAN NOT NULL DEFAULT false,
    "max_steps" INTEGER,
    "role" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_playbooks_pkey" PRIMARY KEY ("id")
);
