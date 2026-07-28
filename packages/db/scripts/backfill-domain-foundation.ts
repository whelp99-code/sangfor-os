/** U040 conservative legacy-domain backfill.  Dry-run is the default. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { prisma } from '../src/index';

export interface OwnerAssignmentCandidate { id: string; companyId: string; active: boolean }
export type OwnerAssignmentDecision =
  | { kind: 'apply'; ownerAssignmentId: string }
  | { kind: 'quarantine'; reason: 'owner_assignment_missing' | 'owner_assignment_ambiguous' };

export function classifyOwnerAssignment(input: { companyId: string; candidates: OwnerAssignmentCandidate[] }): OwnerAssignmentDecision {
  const matches = input.candidates.filter((candidate) => candidate.active && candidate.companyId === input.companyId);
  if (matches.length === 1) return { kind: 'apply', ownerAssignmentId: matches[0].id };
  return { kind: 'quarantine', reason: matches.length === 0 ? 'owner_assignment_missing' : 'owner_assignment_ambiguous' };
}

type Count = { before: number; candidate: number; applied: number; quarantined: number; after: number };
type Receipt = { schemaVersion: 1; mode: 'dry-run' | 'apply'; counts: Record<string, Count>; renewal_asset_orphan: number; applied: number; quarantined: number };
const client = prisma as any;

function count(n = 0): Count { return { before: n, candidate: 0, applied: 0, quarantined: 0, after: n }; }
function sha(value: string) { return createHash('sha256').update(value).digest('hex'); }
function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('usage: backfill-domain-foundation.ts [--mode dry-run|apply] [--receipt path]');
  const receiptPath = args.includes('--receipt') ? args[args.indexOf('--receipt') + 1] : undefined;
  return { mode, receiptPath } as { mode: 'dry-run' | 'apply'; receiptPath?: string };
}
async function assertScratchSentinel() {
  const rows = await client.$queryRawUnsafe("SELECT coalesce(shobj_description(oid, 'pg_database'), '') AS comment FROM pg_database WHERE datname = current_database()");
  if (!String(rows[0]?.comment ?? '').includes('"ownerUnit":"U040"')) throw new Error('U040 requires an isolated U009/U040 scratch sentinel');
}
async function quarantine(model: string, id: string, reason: string) {
  const payload = JSON.stringify({ schemaVersion: 1, sourceModel: model, sourceIdHash: sha(id), reason });
  await client.$executeRawUnsafe(
    `INSERT INTO scope_backfill_quarantine (id, source_model, source_id, reason_code, source_row_json, source_row_hash, candidate_scope_json, first_seen_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT (source_model, source_id) DO UPDATE SET reason_code=EXCLUDED.reason_code,last_seen_at=CURRENT_TIMESTAMP`,
    `u040-${sha(`${model}:${id}`).slice(0, 24)}`, model, id, reason, payload, sha(payload), JSON.stringify({ candidates: [] }),
  );
}
async function main() {
  const { mode, receiptPath } = parseArgs();
  await assertScratchSentinel();
  const counts: Record<string, Count> = {
    ownerAssignment: count(), productFamily: count(), licenseMetric: count(), qualification: count(),
    certification: count(), quote: count(), quoteLine: count(), supportPolicy: count(), supportSnapshot: count(), renewalAsset: count(),
  };
  const owners = await client.$queryRawUnsafe(`SELECT o.id, o.owner_id, p.company_id FROM opportunities o JOIN projects p ON p.id=o.project_id WHERE o.owner_id IS NOT NULL AND o.owner_assignment_id IS NULL ORDER BY o.id`);
  counts.ownerAssignment.before = owners.length;
  for (const row of owners) {
    const candidates = await client.$queryRawUnsafe(`SELECT id, company_id AS "companyId", (status='active' AND revoked_at IS NULL AND (valid_from IS NULL OR valid_from<=CURRENT_TIMESTAMP) AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)) AS active FROM user_company_roles WHERE user_id=$1`, row.owner_id);
    const decision = classifyOwnerAssignment({ companyId: row.company_id, candidates });
    if (decision.kind === 'apply') {
      counts.ownerAssignment.candidate++;
      // This is a one-time legacy bridge, not an owner reassignment: it retains revision 0 and
      // never changes owner_id or any historical attribution.  U032's normal CAS guard governs
      // every non-legacy mutation; its triggers are suppressed only within this scratch-sentinel
      // transaction for the exact NULL -> verified role mapping below.
      if (mode === 'apply') {
        const changed = await client.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          return tx.$executeRawUnsafe(
            'UPDATE opportunities SET owner_assignment_id=$1 WHERE id=$2 AND owner_id=$3 AND owner_assignment_id IS NULL AND ownership_revision=0',
            decision.ownerAssignmentId, row.id, row.owner_id,
          );
        });
        counts.ownerAssignment.applied += Number(changed);
      }
    } else {
      counts.ownerAssignment.quarantined++;
      if (mode === 'apply') await quarantine('Opportunity', row.id, decision.reason);
    }
  }
  const families = await client.$queryRawUnsafe('SELECT id, vendor, name FROM product_families WHERE company_id IS NULL ORDER BY id');
  counts.productFamily.before = families.length;
  for (const row of families) {
    const collision = Number((await client.$queryRawUnsafe(`SELECT count(*)::int AS count FROM product_families WHERE lower(vendor)=lower($1) AND lower(name)=lower($2)`, row.vendor, row.name))[0]?.count ?? 0);
    if (collision > 1) {
      counts.productFamily.quarantined++;
      if (mode === 'apply') await quarantine('ProductFamily', row.id, 'catalog_key_collision');
      continue;
    }
    const ids = await client.$queryRawUnsafe(`
      SELECT DISTINCT company_id AS id FROM (
        SELECT p.company_id
          FROM customer_assets ca JOIN customers c ON c.id=ca.customer_id JOIN projects p ON p.id=c.project_id
         WHERE ca.product_family_id=$1 AND p.company_id IS NOT NULL
        UNION
        SELECT q.company_id
          FROM quote_line_items qli JOIN product_skus sku ON sku.id=qli.sku_id
          JOIN product_editions edition ON edition.id=sku.edition_id
          JOIN quotes q ON q.id=qli.quote_id
         WHERE edition.family_id=$1 AND q.company_id IS NOT NULL
      ) AS evidence`, row.id);
    counts.productFamily.candidate += ids.length === 1 ? 1 : 0;
    if (ids.length === 1 && mode === 'apply') {
      const changed = await client.$executeRawUnsafe('UPDATE product_families SET company_id=$1 WHERE id=$2 AND company_id IS NULL', ids[0].id, row.id);
      counts.productFamily.applied += Number(changed);
    }
    else if (ids.length !== 1) { counts.productFamily.quarantined++; if (mode === 'apply') await quarantine('ProductFamily', row.id, ids.length === 0 ? 'catalog_scope_unresolved' : 'catalog_scope_ambiguous'); }
  }
  const metrics = await client.$queryRawUnsafe('SELECT id, key FROM license_metrics WHERE product_family_id IS NULL ORDER BY id');
  counts.licenseMetric.before = metrics.length;
  for (const row of metrics) {
    const ids = await client.$queryRawUnsafe(`SELECT DISTINCT pe.family_id AS id FROM product_skus ps JOIN product_editions pe ON pe.id=ps.edition_id WHERE ps.license_metric=$1`, row.key);
    counts.licenseMetric.candidate += ids.length === 1 ? 1 : 0;
    if (ids.length === 1 && mode === 'apply') {
      const metricChanged = await client.$executeRawUnsafe('UPDATE license_metrics SET product_family_id=$1 WHERE id=$2 AND product_family_id IS NULL', ids[0].id, row.id);
      const skuChanged = await client.$executeRawUnsafe('UPDATE product_skus SET license_metric_id=$1 WHERE license_metric=$2 AND license_metric_id IS NULL', row.id, row.key);
      counts.licenseMetric.applied += Number(metricChanged) + Number(skuChanged);
    }
    else if (ids.length !== 1) { counts.licenseMetric.quarantined++; if (mode === 'apply') await quarantine('LicenseMetric', row.id, ids.length === 0 ? 'catalog_scope_unresolved' : 'catalog_scope_ambiguous'); }
  }
  if (mode === 'apply') {
    counts.qualification.applied = await client.$executeRawUnsafe("UPDATE deal_qualifications SET scoring_version='bant-v0', revision=1 WHERE scoring_version IS NULL OR revision IS NULL");
  } else {
    counts.qualification.candidate = Number((await client.$queryRawUnsafe("SELECT count(*)::int AS count FROM deal_qualifications WHERE scoring_version IS NULL OR revision IS NULL"))[0]?.count ?? 0);
  }
  const certifications = await client.$queryRawUnsafe("SELECT id, \"engineerId\" AS engineer_id, \"productName\" AS product_name, level FROM engineer_certifications WHERE status IS NULL OR revision IS NULL ORDER BY id");
  counts.certification.before = certifications.length;
  for (const row of certifications) {
    const memberships = await client.$queryRawUnsafe(`SELECT id, company_id FROM user_company_roles WHERE user_id=$1 AND status='active' AND revoked_at IS NULL AND (valid_from IS NULL OR valid_from<=CURRENT_TIMESTAMP) AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) ORDER BY id`, row.engineer_id);
    const membership = memberships.length === 1 ? memberships[0] : null;
    let definition: { id: string } | null = null;
    if (membership) {
      const families = await client.$queryRawUnsafe('SELECT id FROM product_families WHERE company_id=$1 AND lower(name)=lower($2) ORDER BY id', membership.company_id, row.product_name);
      if (families.length === 1) {
        const definitionId = `u040-${sha(`CertificationDefinition:${membership.company_id}:${row.product_name}:${row.level ?? ''}`).slice(0, 24)}`;
        if (mode === 'apply') await client.$executeRawUnsafe(
          `INSERT INTO certification_definitions (id,company_id,key,name,vendor_key,product_family_id,level,issuer,status,updated_at)
           VALUES ($1,$2,$3,$4,'legacy',$5,$6,'Legacy import','active',CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO NOTHING`, definitionId, membership.company_id, `legacy-${sha(row.product_name).slice(0, 12)}`, row.product_name, families[0].id, row.level,
        );
        definition = { id: definitionId };
      }
    }
    if (membership && definition) counts.certification.candidate++;
    if (mode === 'apply') {
      const changed = await client.$executeRawUnsafe(
        `UPDATE engineer_certifications SET definition_id=$1, engineer_membership_id=$2, status='legacy_unverified', revision=0
          WHERE id=$3 AND status IS NULL AND revision IS NULL`, definition?.id ?? null, membership?.id ?? null, row.id,
      );
      counts.certification.applied += Number(changed);
    }
  }
  const quotes = await client.$queryRawUnsafe('SELECT id, company_id, opportunity_id, status, version, total_revenue::text AS total_revenue, total_cost::text AS total_cost, margin_pct::text AS margin_pct, created_by, created_at FROM quotes WHERE content_hash IS NULL ORDER BY id');
  counts.quote.before = quotes.length;
  for (const row of quotes) {
    const currency = 'USD'; // The non-secret legacy fixture's declared commercial convention.
    const contentHash = sha(JSON.stringify({ id: row.id, companyId: row.company_id, opportunityId: row.opportunity_id, status: row.status, version: row.version, totalRevenue: row.total_revenue, totalCost: row.total_cost, marginPct: row.margin_pct, createdBy: row.created_by, createdAt: String(row.created_at), currency }));
    counts.quote.candidate++;
    if (mode === 'apply') counts.quote.applied += Number(await client.$executeRawUnsafe('UPDATE quotes SET currency=$1, content_hash=$2 WHERE id=$3 AND content_hash IS NULL', currency, contentHash, row.id));
  }
  const quoteLines = await client.$queryRawUnsafe('SELECT qli.id, q.currency FROM quote_line_items qli JOIN quotes q ON q.id=qli.quote_id WHERE qli.quantity_decimal IS NULL OR qli.currency IS NULL ORDER BY qli.id');
  counts.quoteLine.before = quoteLines.length;
  for (const row of quoteLines) {
    if (!row.currency) { counts.quoteLine.quarantined++; if (mode === 'apply') await quarantine('QuoteLineItem', row.id, 'quote_currency_unresolved'); continue; }
    counts.quoteLine.candidate++;
    if (mode === 'apply') counts.quoteLine.applied += Number(await client.$executeRawUnsafe('UPDATE quote_line_items SET quantity_decimal=quantity::numeric, currency=$1 WHERE id=$2 AND (quantity_decimal IS NULL OR currency IS NULL)', row.currency, row.id));
  }
  const policies = await client.$queryRawUnsafe(`SELECT policy.id, policy.name, policy."responseTimeHrs" AS response_hours, policy."resolutionTimeHrs" AS resolution_hours, policy.severity, policy."isActive" AS is_active, array_agg(DISTINCT project.company_id) FILTER (WHERE project.company_id IS NOT NULL) AS company_ids FROM support_sla_policies policy LEFT JOIN support_cases sc ON true LEFT JOIN customers customer ON customer.id=sc.customer_id LEFT JOIN projects project ON project.id=customer.project_id WHERE policy.company_id IS NULL GROUP BY policy.id ORDER BY policy.id`);
  counts.supportPolicy.before = policies.length;
  for (const row of policies) {
    const companyIds = (row.company_ids ?? []).filter(Boolean);
    if (companyIds.length !== 1) { counts.supportPolicy.quarantined++; if (mode === 'apply') await quarantine('SupportSlaPolicy', row.id, companyIds.length === 0 ? 'support_policy_scope_unresolved' : 'support_policy_scope_ambiguous'); continue; }
    const companyId = companyIds[0]; const versionId = `u040-${sha(`SupportSlaPolicyVersion:${row.id}:${companyId}`).slice(0, 24)}`;
    const responseMinutes = Math.max(1, Number(row.response_hours ?? 1) * 60); const resolutionMinutes = Math.max(responseMinutes, Number(row.resolution_hours ?? row.response_hours ?? 1) * 60); const severity = String(row.severity ?? 'medium');
    const contentHash = sha(JSON.stringify({ policyId: row.id, companyId, severity, responseMinutes, resolutionMinutes, clockKind: 'elapsed_24x7' }));
    counts.supportPolicy.candidate++;
    if (mode === 'apply') {
      await client.$executeRawUnsafe('UPDATE support_sla_policies SET company_id=$1, policy_key=$2 WHERE id=$3 AND company_id IS NULL', companyId, `legacy-${sha(row.name).slice(0, 12)}`, row.id);
      await client.$executeRawUnsafe(`INSERT INTO support_sla_policy_versions (id,company_id,policy_id,version,severity,response_minutes,resolution_minutes,clock_kind,content_hash,effective_at) VALUES ($1,$2,$3,1,$4,$5,$6,'elapsed_24x7',$7,CURRENT_TIMESTAMP) ON CONFLICT (policy_id,version) DO NOTHING`, versionId, companyId, row.id, severity, responseMinutes, resolutionMinutes, contentHash);
      await client.$executeRawUnsafe('UPDATE support_sla_policies SET current_version_id=$1 WHERE id=$2 AND current_version_id IS NULL', versionId, row.id);
      counts.supportPolicy.applied++;
    }
  }
  const supportCases = await client.$queryRawUnsafe(`SELECT sc.id, sc.created_at, policy_version.id AS policy_version_id, policy_version.severity, policy_version.response_minutes, policy_version.resolution_minutes, policy_version.vendor_escalation_minutes, policy_version.customer_update_minutes FROM support_cases sc JOIN customers customer ON customer.id=sc.customer_id JOIN projects project ON project.id=customer.project_id JOIN support_sla_policies policy ON policy.company_id=project.company_id AND policy."isActive"=true JOIN support_sla_policy_versions policy_version ON policy_version.id=policy.current_version_id WHERE sc.sla_deadline IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_case_sla_snapshots snapshot WHERE snapshot.support_case_id=sc.id) ORDER BY sc.id`);
  counts.supportSnapshot.before = supportCases.length;
  for (const row of supportCases) {
    const startedAt = new Date(row.created_at); const responseDue = new Date(startedAt.getTime() + Number(row.response_minutes) * 60_000); const resolutionDue = new Date(startedAt.getTime() + Number(row.resolution_minutes) * 60_000); const snapshotHash = sha(JSON.stringify({ supportCaseId: row.id, policyVersionId: row.policy_version_id, startedAt: startedAt.toISOString(), responseDue: responseDue.toISOString(), resolutionDue: resolutionDue.toISOString() }));
    counts.supportSnapshot.candidate++;
    if (mode === 'apply') counts.supportSnapshot.applied += Number(await client.$executeRawUnsafe(`INSERT INTO support_case_sla_snapshots (id,support_case_id,policy_version_id,severity,response_minutes,resolution_minutes,vendor_escalation_minutes,customer_update_minutes,clock_kind,started_at,response_due_at,resolution_due_at,snapshot_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'elapsed_24x7',$9,$10,$11,$12) ON CONFLICT (support_case_id) DO NOTHING`, `u040-${sha(`SupportCaseSlaSnapshot:${row.id}`).slice(0, 24)}`, row.id, row.policy_version_id, row.severity, row.response_minutes, row.resolution_minutes, row.vendor_escalation_minutes, row.customer_update_minutes, startedAt, responseDue, resolutionDue, snapshotHash));
  }
  const orphanRows = await client.$queryRawUnsafe('SELECT ro.id FROM renewal_opportunities ro LEFT JOIN customer_assets ca ON ca.id=ro.asset_id WHERE ro.asset_id IS NOT NULL AND ca.id IS NULL');
  for (const row of orphanRows) if (mode === 'apply') await quarantine('RenewalOpportunity', row.id, 'renewal_asset_orphan');
  counts.renewalAsset.quarantined = orphanRows.length;
  const receipt: Receipt = { schemaVersion: 1, mode, counts, renewal_asset_orphan: orphanRows.length, applied: Object.values(counts).reduce((n, x) => n + x.applied, 0), quarantined: Object.values(counts).reduce((n, x) => n + x.quarantined, 0) };
  const encoded = `${JSON.stringify(receipt)}\n`;
  if (receiptPath) writeFileSync(receiptPath, encoded, 'utf8');
  process.stdout.write(encoded);
  if (receipt.renewal_asset_orphan > 0 || (mode === 'apply' && receipt.quarantined > 0)) process.exitCode = 1;
}
if (process.argv[1]?.endsWith('backfill-domain-foundation.ts')) {
  main().catch((error) => { process.stderr.write(`U040_BACKFILL_REJECTED ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
