import type { PrismaClient } from "@prisma/client";

/**
 * Tables where U043 service operations require WRITE (INSERT/UPDATE/DELETE) access within RLS transactions.
 * Note: Prisma model `Engagement` maps to SQL table `delivery_projects`.
 */
const U043_WRITE_TABLES = [
  // customer-partner.ts:appendActivityLog - write activity logs
  "customer_activity_logs",
  // opportunity-center.ts:addOpportunityLink - write opportunity links
  "opportunity_links",
  // opportunity-center.ts:upsertDealQualification - write deal qualifications
  "deal_qualifications",
  // deal-registration.ts:upsertDealRegistration - write deal registrations
  "deal_registrations",
  // opportunity-center.ts:logStageEvent - write stage events
  "opportunity_stage_events",
  // engagement-center.ts:executeOpportunityConversion - write engagements (mapped to delivery_projects table)
  "delivery_projects",
  // engagement-center.ts:executeOpportunityConversion - update poc projects to link engagementId
  "poc_projects",
  // engagement-center.ts:executeOpportunityConversion - update generated documents to link engagementId
  "generated_documents",
  // engagement-center.ts:executeOpportunityConversion - update meeting notes to link engagementId
  "meeting_notes",
  // opportunity-center.ts:logStateTransition - write state transition logs
  "state_transition_logs",
  // ai-decision-deal-registration.ts:recordDealRegistrationDecision - write decision logs
  "domain_decision_logs",
] as const;

/**
 * Tables where U043 service operations require READ-ONLY (SELECT) access within RLS transactions.
 */
const U043_READ_ONLY_TABLES = [
  // customer-partner.ts:getCustomerDetail - select partner
  "partners",
  // customer-partner.ts:getCustomerDetail - select customer assets
  "customer_assets",
  // customer-partner.ts:getCustomerDetail - select renewal opportunities
  "renewal_opportunities",
  // customer-partner.ts:getCustomerDetail - select support cases
  "support_cases",
  // customer-partner.ts:resolveActorAssignment - select user info
  "users",
  // customer-partner.ts:getCustomerDetail - select work tasks
  "work_tasks",
  // customer-partner.ts:getCustomerDetail - select contacts
  "contacts",
  // customer-partner.ts:getCustomerDetail - select customer partner links
  "customer_partner_links",
  // engagement-center.ts:currentAbsorbed - select quotes
  "quotes",
] as const;

export async function applyU043RlsGrants(admin: PrismaClient) {
  const allTables = [...U043_WRITE_TABLES, ...U043_READ_ONLY_TABLES];

  // Verify all target tables exist via to_regclass; throw if any table is missing (do not hide migration drift)
  for (const table of allTables) {
    const [{ regclass }] = await admin.$queryRawUnsafe<{ regclass: string | null }[]>(
      `SELECT to_regclass('public."${table}"')::text as regclass;`
    );
    if (!regclass) {
      throw new Error(
        `Migration drift detected: table "public.${table}" does not exist in the scratch database.`
      );
    }
  }

  // Grant CRUD (SELECT, INSERT, UPDATE, DELETE) for write tables
  for (const table of U043_WRITE_TABLES) {
    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO sangfor_app;`
    );
  }

  // Grant SELECT-only for read-only tables
  for (const table of U043_READ_ONLY_TABLES) {
    await admin.$executeRawUnsafe(
      `GRANT SELECT ON TABLE "${table}" TO sangfor_app;`
    );
  }
}
