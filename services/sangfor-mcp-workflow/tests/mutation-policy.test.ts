import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDomainSeparatedEngineerMcpLaunch } from '../packages/shared/src/mutation-policy.js';

const workflowRoot = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createDomainSeparatedEngineerMcpLaunch', () => {
  it('uses workflow-local tsx when the engineer workspace dependencies are absent', () => {
    const engineerRoot = mkdtempSync(join(tmpdir(), 'sangfor-engineer-no-deps-'));
    temporaryDirectories.push(engineerRoot);
    mkdirSync(join(engineerRoot, 'apps/mcp-server/src'), { recursive: true });
    writeFileSync(join(engineerRoot, 'apps/mcp-server/src/index.ts'), 'export {};\n');
    writeFileSync(join(engineerRoot, 'tsconfig.json'), '{}\n');

    const launch = createDomainSeparatedEngineerMcpLaunch({
      workflowRoot,
      engineerRoot,
      requestApiKey: 'a'.repeat(64),
      environment: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        AUTH_BYPASS_ENABLED: '0',
        WHELP99_ENFORCE_SAFE_TOOLS: 'true',
        SANGFOR_OPERATOR_PRINCIPAL_ID: 'ci-operator',
      },
    });

    expect(launch.spawnOptions.args[0]).toBe(join(workflowRoot, 'node_modules/tsx/dist/cli.mjs'));
    expect(launch.spawnOptions.args[1]).toBe(join(engineerRoot, 'apps/mcp-server/src/index.ts'));
  });
});
