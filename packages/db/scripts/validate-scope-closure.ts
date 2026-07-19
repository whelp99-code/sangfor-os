import { Prisma } from '@prisma/client';

import { prisma } from '../src/index';
import { buildClosureReport, fetchClosureFacts, type DigestClient } from '../src/scope-closure';
import { MODEL_SCOPE_INVENTORY } from '../src/scope-inventory';

async function main(): Promise<number> {
  const client = prisma as unknown as DigestClient;
  const currentModelNames = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const entries = Object.values(MODEL_SCOPE_INVENTORY);

  const facts = await fetchClosureFacts(client, currentModelNames, entries, Prisma.dmmf);
  const report = buildClosureReport(facts);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, result: 'REJECTED', message: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
