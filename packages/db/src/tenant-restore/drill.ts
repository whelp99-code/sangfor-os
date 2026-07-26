import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgresPair } from '../../../../scripts/lib/isolated-postgres.mjs';
import { exportTenantScope } from './export';
import { tableHash } from './hash';
import { importTenantScope } from './import';
import { RESTORE_TABLE_SPECS } from './identifiers';

export type TenantRestoreDrillOptions = {
  runId: string;
  evidenceDir: string;
  imageDigest: string;
};

export type TenantRestoreDrillResult = {
  imported: boolean;
  idempotentReplay: boolean;
  tableCounts: Record<string, number>;
  remapCount: number;
  targetCounts: Record<string, number>;
  tamperRejected: boolean;
  crossScopeRejected: boolean;
};

export async function runTenantSelectiveRestoreDrill(
  options: TenantRestoreDrillOptions,
): Promise<TenantRestoreDrillResult> {
  if (process.env.DATABASE_URL) throw new Error('U074 refuses caller DATABASE_URL');
  mkdirSync(options.evidenceDir, { recursive: true });
  const previousNpmConfigPrefix = process.env.npm_config_prefix;
  delete process.env.npm_config_prefix;

  try {
    return await withIsolatedPostgresPair(
    {
      runId: options.runId,
      ownerUnit: 'U074',
      purpose: 'tenant-selective-restore-drill',
      evidenceDir: options.evidenceDir,
      imageDigest: options.imageDigest,
      migrate: true,
      applicationRoleMode: 'required',
    },
    async ({ primary, secondary }: {
      primary: { migrationDatabaseUrl: string };
      secondary: { migrationDatabaseUrl: string };
    }) => {
      const source = new PrismaClient({ datasources: { db: { url: primary.migrationDatabaseUrl } } });
      const target = new PrismaClient({ datasources: { db: { url: secondary.migrationDatabaseUrl } } });
      try {
        await source.tenant.create({ data: { id: 'src-tenant', slug: 'src-tenant', name: 'Source Tenant', status: 'active' } });
        await source.company.create({ data: { id: 'src-company', tenantId: 'src-tenant', slug: 'src-company', name: 'Source Company' } });
        await source.project.create({ data: { id: 'src-project', companyId: 'src-company', slug: 'src-project', name: 'Source Project' } });
        await source.customer.create({ data: { id: 'src-customer-1', projectId: 'src-project', name: 'Customer A', status: 'active' } });
        await source.customer.create({ data: { id: 'src-customer-2', projectId: 'src-project', name: 'Customer B', status: 'active' } });
        await source.customerActivityLog.create({ data: { id: 'src-activity-1', customerId: 'src-customer-1', activityType: 'restore_drill', summary: 'U074 child fixture' } });

        await target.tenant.create({ data: { id: 'tgt-tenant', slug: 'tgt-tenant', name: 'Target Tenant', status: 'active' } });

        const exported = await exportTenantScope(source, {
          runId: `${options.runId}-export`,
          tenantId: 'src-tenant',
          companyId: 'src-company',
          projectId: 'src-project',
          imageDigest: options.imageDigest,
          tables: RESTORE_TABLE_SPECS,
        });
        writeFileSync(join(options.evidenceDir, 'export-manifest.json'), JSON.stringify(exported.manifest, null, 2));

        const importOptions = {
          targetTenantId: 'tgt-tenant',
          targetCompanyId: 'tgt-company',
          targetProjectId: 'tgt-project',
          idempotencyKey: `${options.runId}:import`,
        };
        const imported = await importTenantScope(target, exported.manifest, exported.rows, importOptions);
        const replay = await importTenantScope(target, exported.manifest, exported.rows, importOptions);

        const targetCounts = {
          companies: await target.company.count({ where: { tenantId: 'tgt-tenant' } }),
          projects: await target.project.count({ where: { id: 'tgt-project', companyId: 'tgt-company' } }),
          customers: await target.customer.count({ where: { projectId: 'tgt-project' } }),
          customer_activity_logs: await target.customerActivityLog.count({
            where: { customer: { projectId: 'tgt-project' } },
          }),
        };

        let tamperRejected = false;
        try {
          await importTenantScope(target, { ...exported.manifest, schemaHash: 'tampered' }, exported.rows, {
            ...importOptions,
            idempotencyKey: `${options.runId}:tampered`,
          });
        } catch {
          tamperRejected = true;
        }

        const crossScopeRows = structuredClone(exported.rows);
        crossScopeRows.customer_activity_logs[0].customer_id = 'foreign-customer';
        const crossScopeManifest = structuredClone(exported.manifest);
        const activityEntry = crossScopeManifest.tableInventory.find((entry) => entry.table === 'customer_activity_logs');
        if (!activityEntry) throw new Error('U074 fixture manifest lacks CHILD_VIA_FK table');
        activityEntry.tableHash = tableHash(crossScopeRows.customer_activity_logs);
        let crossScopeRejected = false;
        try {
          await importTenantScope(target, crossScopeManifest, crossScopeRows, {
            ...importOptions,
            idempotencyKey: `${options.runId}:cross-scope`,
          });
        } catch {
          crossScopeRejected = true;
        }

        const result: TenantRestoreDrillResult = {
          imported: imported.imported,
          idempotentReplay: replay.idempotent,
          tableCounts: imported.tableCounts,
          remapCount: Object.keys(imported.remapMap).length,
          targetCounts,
          tamperRejected,
          crossScopeRejected,
        };
        writeFileSync(join(options.evidenceDir, 'restore-result.json'), JSON.stringify(result, null, 2));
        writeFileSync(join(options.evidenceDir, 'import-remap.json'), JSON.stringify(imported.remapMap, null, 2));
        return result;
      } finally {
        await source.$disconnect();
        await target.$disconnect();
      }
    },
    );
  } finally {
    if (previousNpmConfigPrefix === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = previousNpmConfigPrefix;
  }
}
