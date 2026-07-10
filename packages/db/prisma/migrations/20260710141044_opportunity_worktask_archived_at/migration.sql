-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "archived_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "work_tasks" ADD COLUMN     "archived_at" TIMESTAMP(3);
