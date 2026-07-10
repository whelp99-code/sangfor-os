-- CreateTable
CREATE TABLE "autonomy_policies" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "minAutonomy" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "minSamples" INTEGER NOT NULL DEFAULT 10,
    "requireColorGatePass" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_policies_domain_decisionType_key" ON "autonomy_policies"("domain", "decisionType");
