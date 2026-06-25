import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

@Injectable()
export class NotionSyncService {
  status() {
    const exportDir = process.env.NOTION_EXPORT_DIR ?? '';
    const hasApiKey = Boolean(process.env.NOTION_API_KEY);
    return {
      csvImportDir: exportDir || '(NOTION_EXPORT_DIR not set)',
      csvImportReady: Boolean(exportDir),
      liveApiKeyConfigured: hasApiKey,
      liveSyncNote: 'Live Notion sync requires Integration on each inline DB — see NOTION_MCP_GUIDE.md',
    };
  }

  async triggerCsvImport() {
    const exportDir = process.env.NOTION_EXPORT_DIR;
    if (!exportDir) {
      return {
        ok: false,
        error: 'Set NOTION_EXPORT_DIR in .env to the Notion CSV export folder',
      };
    }
    const script = path.join(process.cwd(), 'scripts/import-csv-to-prisma.ts');
    try {
      const { stdout, stderr } = await execFileAsync(
        'pnpm',
        ['exec', 'tsx', script],
        {
          env: { ...process.env, NOTION_EXPORT_DIR: exportDir },
          cwd: process.cwd(),
        },
      );
      return { ok: true, stdout, stderr };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e), stderr: e?.stderr };
    }
  }
}
