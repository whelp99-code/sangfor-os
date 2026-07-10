/**
 * report-domain-pollution.ts — dry-run report of mail_candidate domain_decision_logs
 * that would now map to "presales" under the candidateType->GtmDomain derivation.
 *
 * Counts rows where caseRef LIKE 'mail_candidate:%' AND domain='sales', joined to
 * mail_derived_candidates where candidateType='poc' (i.e. rows that the derivation
 * in gtmDomainForCandidate would now assign to presales).
 *
 * 실행: npx tsx packages/business/scripts/report-domain-pollution.ts
 */
import { prisma } from "@sangfor/db";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT ddl.id
     FROM domain_decision_logs ddl
     JOIN mail_derived_candidates mdc ON mdc.id = substring(ddl.case_ref, 16)
     WHERE ddl.case_ref LIKE 'mail_candidate:%'
       AND ddl.domain = 'sales'
       AND mdc.candidate_type = 'poc'`,
  );

  console.log(`domain-pollution poc-under-sales: ${rows.length}`);
  console.log("");

  if (rows.length > 0) {
    const sample = rows.slice(0, 20);
    console.log("sample ids (up to 20):");
    for (const row of sample) {
      console.log(`  ${row.id}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
