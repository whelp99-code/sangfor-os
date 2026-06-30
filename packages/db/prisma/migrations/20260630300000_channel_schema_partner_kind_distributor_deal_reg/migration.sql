-- Additive: channel schema — Partner.kind, Opportunity.distributorId, DealRegistration
-- Real table names confirmed: partners (Partner @@map), opportunities (Opportunity @@map)
-- Constraint: no changes to existing enums (opportunity_stage, deal_status); CFO tables untouched

-- CreateEnum: partner_kind
CREATE TYPE "partner_kind" AS ENUM ('VENDOR', 'DISTRIBUTOR', 'RESELLER');

-- CreateEnum: reg_status
CREATE TYPE "reg_status" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONTESTED');

-- AlterTable partners: add kind column (nullable — existing rows stay null)
ALTER TABLE "partners" ADD COLUMN "kind" "partner_kind";

-- AlterTable opportunities: add distributor_id column (nullable)
ALTER TABLE "opportunities" ADD COLUMN "distributor_id" text;

-- FK: opportunities.distributor_id -> partners.id ON DELETE SET NULL
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_distributor_id_fkey"
  FOREIGN KEY ("distributor_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: deal_registrations
CREATE TABLE "deal_registrations" (
  "id"                   text NOT NULL,
  "opportunity_id"       text NOT NULL,
  "distributor_id"       text,
  "registration_number"  text,
  "reg_status"           "reg_status" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "protection_expires_at" timestamp(3),
  "spr_status"           text,
  "partner_tier_margin"  decimal(5,2),
  "conflict_note"        text,
  "created_at"           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deal_registrations_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one DealRegistration per Opportunity
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_opportunity_id_key" UNIQUE ("opportunity_id");

-- FK: deal_registrations.opportunity_id -> opportunities.id ON DELETE CASCADE
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_opportunity_id_fkey"
  FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: deal_registrations.distributor_id -> partners.id ON DELETE SET NULL
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_distributor_id_fkey"
  FOREIGN KEY ("distributor_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index: deal_registrations on opportunity_id
CREATE INDEX "deal_registrations_opportunity_id_idx" ON "deal_registrations"("opportunity_id");

-- Index: deal_registrations on (protection_expires_at, reg_status) for expiry sweeps
CREATE INDEX "deal_registrations_protection_expires_at_reg_status_idx" ON "deal_registrations"("protection_expires_at", "reg_status");
