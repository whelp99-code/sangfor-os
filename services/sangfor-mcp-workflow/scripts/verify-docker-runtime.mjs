/**
 * U004 Docker runtime lifecycle owner.
 * Exact argv arrays, env validation, health/auth/filesystem checks, idempotent cleanup.
 */
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const EXIT_DOCKER_PREFLIGHT = 64;

/** @typedef {{ kind: 'network' | 'container' | 'image', name: string, created: boolean }} ResourceReceipt */

export function validateEnv(env = process.env) {
  /** @type {string[]} */
  const errors = [];
  const taskRunId = env.TASK_RUN_ID;
  const leasedWebPort = env.LEASED_WEB_PORT;
  const evidenceDir = env.U004_EVIDENCE_DIR;

  if (typeof taskRunId !== 'string' || !TASK_RUN_ID_RE.test(taskRunId)) {
    errors.push('TASK_RUN_ID must match ^[a-z0-9][a-z0-9-]{0,47}$');
  }
  const portNum = Number(leasedWebPort);
  if (
    typeof leasedWebPort !== 'string'
    || !/^\d+$/.test(leasedWebPort)
    || !Number.isInteger(portNum)
    || portNum < 1024
    || portNum > 65535
  ) {
    errors.push('LEASED_WEB_PORT must be decimal integer 1024-65535');
  }
  if (typeof evidenceDir !== 'string' || !isAbsolute(evidenceDir)) {
    errors.push('U004_EVIDENCE_DIR must be an absolute path');
  } else if (!evidenceDir.includes('U004')) {
    errors.push('U004_EVIDENCE_DIR must be under a U004 attempt path');
  }
  if (env.DOCKER_HOST !== undefined && env.DOCKER_HOST !== '') {
    errors.push('DOCKER_HOST must not be set in caller env');
  }
  if (env.DOCKER_CONTEXT !== undefined && env.DOCKER_CONTEXT !== '') {
    errors.push('DOCKER_CONTEXT must not be set in caller env');
  }
  if (errors.length > 0) {
    const err = new Error(errors.join('; '));
    err.code = 'ENV_VALIDATION';
    throw err;
  }
  return {
    taskRunId: /** @type {string} */ (taskRunId),
    leasedWebPort: portNum,
    evidenceDir: /** @type {string} */ (evidenceDir),
  };
}

/**
 * @param {string} taskRunId
 * @param {number} port
 */
export function buildDockerArgv(taskRunId, port) {
  const r = taskRunId;
  const p = String(port);
  const labels = {
    run: `com.sangfor.refactor.run=${r}`,
    unit: 'com.sangfor.refactor.unit=U004',
  };
  const mcpImage = `sangfor-workflow-mcp:${r}`;
  const operatorImage = `sangfor-workflow-operator:${r}`;
  const network = `sangfor-u004-${r}`;
  const mcpContainer = `sangfor-u004-mcp-${r}`;
  const operatorContainer = `sangfor-u004-operator-${r}`;

  return {
    names: { mcpImage, operatorImage, network, mcpContainer, operatorContainer },
    preflight: {
      contextInspect: ['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
      info: ['docker', 'info', '--format', '{{json .ServerVersion}}'],
    },
    networkCreate: [
      'docker', 'network', 'create',
      '--label', labels.run,
      '--label', labels.unit,
      network,
    ],
    buildMcp: [
      'docker', 'build', '--pull=false',
      '--file', 'apps/mcp-server/Dockerfile',
      '--tag', mcpImage,
      '--label', labels.run,
      '--label', labels.unit,
      '.',
    ],
    buildOperator: [
      'docker', 'build', '--pull=false',
      '--file', 'apps/operator-console/Dockerfile',
      '--tag', operatorImage,
      '--label', labels.run,
      '--label', labels.unit,
      '.',
    ],
    runMcp: [
      'docker', 'run', '--detach', '--interactive',
      '--name', mcpContainer,
      '--label', labels.run,
      '--label', labels.unit,
      '--network', network,
      '--env', 'NODE_ENV=production',
      '--env', `MCP_API_KEY=u004-local-fixture-${r}`,
      '--env', `SANGFOR_OPERATOR_PRINCIPAL_ID=u004-operator-${r}`,
      mcpImage,
    ],
    runOperator: [
      'docker', 'run', '--detach',
      '--name', operatorContainer,
      '--label', labels.run,
      '--label', labels.unit,
      '--network', network,
      '--publish', `127.0.0.1:${p}:3500`,
      '--env', 'NODE_ENV=production',
      '--env', 'PORT=3500',
      '--env', `SANGFOR_API_KEY=u004-local-fixture-${r}`,
      '--env', `SANGFOR_OPERATOR_PRINCIPAL_ID=u004-operator-${r}`,
      operatorImage,
    ],
    inspectContainer: (container) => [
      'docker', 'inspect',
      '--format', '{{json .Config.Cmd}} {{json .State}} {{json .HostConfig.PortBindings}}',
      container,
    ],
    inspectImage: (image) => [
      'docker', 'image', 'inspect',
      '--format', '{{json .Config.Cmd}} {{json .Config.Labels}}',
      image,
    ],
    rmContainer: (container) => ['docker', 'rm', '--force', container],
    rmNetwork: ['docker', 'network', 'rm', network],
    rmImage: (image) => ['docker', 'image', 'rm', '--force', image],
    residueContainers: [
      'docker', 'ps', '-a',
      '--filter', 'label=com.sangfor.refactor.unit=U004',
      '--filter', `label=com.sangfor.refactor.run=${r}`,
      '--format', '{{.ID}}',
    ],
    residueImages: [
      'docker', 'images',
      '--filter', 'label=com.sangfor.refactor.unit=U004',
      '--filter', `label=com.sangfor.refactor.run=${r}`,
      '--format', '{{.ID}}',
    ],
    residueNetworks: [
      'docker', 'network', 'ls',
      '--filter', 'label=com.sangfor.refactor.unit=U004',
      '--filter', `label=com.sangfor.refactor.run=${r}`,
      '--format', '{{.ID}}',
    ],
  };
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, argv: string[] }>}
 */
export function spawnFile(argv, opts = {}) {
  const [file, ...args] = argv;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
        child.kill('SIGKILL');
      }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr, argv });
    });
  });
}

export async function spawnFileExpectZero(argv, opts = {}) {
  const result = await spawnFile(argv, opts);
  if (result.code !== 0) {
    const err = new Error(
      `command failed exit=${result.code}: ${argv.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    err.result = result;
    throw err;
  }
  return result;
}

export function atomicWrite(filePath, data) {
  const dir = resolve(filePath, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

/**
 * @param {string} hostJson
 */
export function assertLocalUnixDockerHost(hostJson) {
  const trimmed = hostJson.trim();
  let host;
  try {
    host = JSON.parse(trimmed);
  } catch {
    host = trimmed.replace(/^"|"$/g, '');
  }
  if (typeof host !== 'string' || !host.startsWith('unix://')) {
    const err = new Error(`DOCKER preflight: non-local host ${trimmed}`);
    err.exitCode = EXIT_DOCKER_PREFLIGHT;
    throw err;
  }
  return host;
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
export async function pollHealth(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/system/health`);
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        lastError = `non-json body status=${response.status}`;
        await sleep(500);
        continue;
      }
      if (response.status === 200 && body && typeof body === 'object' && typeof body.uptime === 'number') {
        return { status: response.status, body };
      }
      lastError = `status=${response.status} body=${text}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`health poll failed within ${timeoutMs}ms: ${lastError}`);
}

export async function assertUnauthenticatedMutationDenied(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/workflows/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerName: 'u004-fixture' }),
  });
  if (response.status === 401 || response.status === 403) {
    return { status: response.status, body: await response.text() };
  }
  throw new Error(`expected 401/403 for unauthenticated mutation, got ${response.status}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scan image filesystem for source TS and entrypoints via docker create+export is heavy;
 * use `docker run --rm --entrypoint` find instead — but that changes Cmd. Prefer
 * `docker image inspect` + ephemeral container with overridden entrypoint.
 */
export async function scanImageFilesystem(image, entryRel, cwd) {
  const script = [
    'set -e',
    'echo "ENTRY=$(test -f /app/' + entryRel + ' && echo 1 || echo 0)"',
    'echo "TS_SRC=$(find /app -type f \\( -name \'*.ts\' -o -name \'*.tsx\' \\) ! -path \'/app/node_modules/*\' 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "TSX_BIN=$(find /app -type f -path \'*/tsx/dist/cli.mjs\' 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "MJS=$(find /app -type f -name \'*.mjs\' ! -path \'/app/node_modules/*\' 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "SRC_DIRS=$(find /app -type d \\( -name src -o -path \'/app/packages/*/src\' \\) ! -path \'/app/node_modules/*\' 2>/dev/null | wc -l | tr -d \' \')"',
  ].join('; ');

  const result = await spawnFile(
    ['docker', 'run', '--rm', '--entrypoint', 'sh', image, '-c', script],
    { cwd, timeoutMs: 120_000 },
  );
  if (result.code !== 0) {
    throw new Error(`filesystem scan failed for ${image}: ${result.stderr}`);
  }
  /** @type {Record<string, string>} */
  const parsed = {};
  for (const line of result.stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  const entry = Number(parsed.ENTRY ?? 0);
  const tsSrc = Number(parsed.TS_SRC ?? -1);
  const mjs = Number(parsed.MJS ?? -1);
  const srcDirs = Number(parsed.SRC_DIRS ?? -1);
  if (entry !== 1) throw new Error(`${image}: missing exact entry ${entryRel}`);
  if (tsSrc !== 0) throw new Error(`${image}: app/workspace source TS count=${tsSrc}`);
  if (mjs !== 1) throw new Error(`${image}: expected exactly 1 non-node_modules .mjs, got ${mjs}`);
  if (srcDirs !== 0) throw new Error(`${image}: source directories present count=${srcDirs}`);
  return parsed;
}

export function createCleanupController(argvPlan, cwd) {
  /** @type {ResourceReceipt[]} */
  const receipts = [];
  let cleaned = false;
  let cleaning = null;

  function track(kind, name) {
    receipts.push({ kind, name, created: true });
  }

  async function cleanup() {
    if (cleaned) return { ok: true, steps: [], already: true };
    if (cleaning) return cleaning;
    cleaning = (async () => {
      /** @type {{ argv: string[], code: number }[]} */
      const steps = [];
      const containers = receipts.filter((r) => r.kind === 'container' && r.created).map((r) => r.name);
      const networks = receipts.filter((r) => r.kind === 'network' && r.created).map((r) => r.name);
      const images = receipts.filter((r) => r.kind === 'image' && r.created).map((r) => r.name);

      for (const c of containers) {
        const result = await spawnFile(argvPlan.rmContainer(c), { cwd });
        steps.push({ argv: result.argv, code: result.code });
        if (result.code !== 0) {
          throw new Error(`cleanup container failed: ${c} exit=${result.code}`);
        }
      }
      for (const n of networks) {
        const result = await spawnFile(argvPlan.rmNetwork, { cwd });
        steps.push({ argv: result.argv, code: result.code });
        if (result.code !== 0) {
          throw new Error(`cleanup network failed: ${n} exit=${result.code}`);
        }
      }
      for (const img of images) {
        const result = await spawnFile(argvPlan.rmImage(img), { cwd });
        steps.push({ argv: result.argv, code: result.code });
        if (result.code !== 0) {
          throw new Error(`cleanup image failed: ${img} exit=${result.code}`);
        }
      }

      // Residue re-check for this run label
      for (const check of [argvPlan.residueContainers, argvPlan.residueImages, argvPlan.residueNetworks]) {
        const result = await spawnFile(check, { cwd });
        const ids = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        if (ids.length > 0) {
          throw new Error(`residue remains after cleanup: ${check.join(' ')} -> ${ids.join(',')}`);
        }
        steps.push({ argv: result.argv, code: result.code });
      }

      cleaned = true;
      return { ok: true, steps, already: false };
    })();
    try {
      return await cleaning;
    } finally {
      cleaning = null;
    }
  }

  return { track, cleanup, receipts: () => receipts.slice() };
}

async function main() {
  const cwd = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  let cfg;
  try {
    cfg = validateEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  mkdirSync(cfg.evidenceDir, { recursive: true });
  const argvPlan = buildDockerArgv(cfg.taskRunId, cfg.leasedWebPort);
  const { track, cleanup, receipts } = createCleanupController(argvPlan, cwd);

  let signalExit = null;
  const onSignal = (sig) => {
    signalExit = 128 + (sig === 'SIGINT' ? 2 : 15);
    void finalize(new Error(`received ${sig}`));
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  let finished = false;
  /** @type {(error?: Error) => Promise<void>} */
  async function finalize(error) {
    if (finished) return;
    finished = true;
    let cleanupResult;
    try {
      cleanupResult = await cleanup();
      atomicWrite(join(cfg.evidenceDir, 'cleanup-receipt.json'), {
        ok: true,
        steps: cleanupResult.steps,
        receipts: receipts(),
      });
    } catch (cleanupError) {
      atomicWrite(join(cfg.evidenceDir, 'cleanup-receipt.json'), {
        ok: false,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        receipts: receipts(),
      });
      process.stderr.write(`cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`);
      process.exitCode = 1;
      return;
    }
    if (signalExit !== null) {
      process.exitCode = signalExit;
      return;
    }
    if (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  }

  try {
    // Preflight
    const contextResult = await spawnFile(argvPlan.preflight.contextInspect, { cwd });
    if (contextResult.code !== 0) {
      const err = new Error(`docker context inspect failed: ${contextResult.stderr}`);
      err.exitCode = EXIT_DOCKER_PREFLIGHT;
      throw err;
    }
    assertLocalUnixDockerHost(contextResult.stdout);
    const infoResult = await spawnFileExpectZero(argvPlan.preflight.info, { cwd });
    atomicWrite(join(cfg.evidenceDir, 'docker-preflight.json'), {
      host: contextResult.stdout.trim(),
      serverVersion: infoResult.stdout.trim(),
    });

    // Network
    await spawnFileExpectZero(argvPlan.networkCreate, { cwd });
    track('network', argvPlan.names.network);

    // Builds
    const buildLog = [];
    const mcpBuild = await spawnFileExpectZero(argvPlan.buildMcp, { cwd, timeoutMs: 1_200_000 });
    track('image', argvPlan.names.mcpImage);
    buildLog.push({ image: argvPlan.names.mcpImage, stdout: mcpBuild.stdout, stderr: mcpBuild.stderr });

    const opBuild = await spawnFileExpectZero(argvPlan.buildOperator, { cwd, timeoutMs: 1_200_000 });
    track('image', argvPlan.names.operatorImage);
    buildLog.push({ image: argvPlan.names.operatorImage, stdout: opBuild.stdout, stderr: opBuild.stderr });
    atomicWrite(join(cfg.evidenceDir, 'docker-build.txt'), buildLog.map((b) =>
      `# ${b.image}\n${b.stdout}\n${b.stderr}\n`).join('\n'));

    // Filesystem scans before long-running containers
    const mcpFs = await scanImageFilesystem(argvPlan.names.mcpImage, 'apps/mcp-server/dist/index.mjs', cwd);
    const opFs = await scanImageFilesystem(argvPlan.names.operatorImage, 'apps/operator-console/dist/server.mjs', cwd);
    atomicWrite(join(cfg.evidenceDir, 'image-filesystem.json'), { mcp: mcpFs, operator: opFs });

    // Run
    await spawnFileExpectZero(argvPlan.runMcp, { cwd });
    track('container', argvPlan.names.mcpContainer);
    await spawnFileExpectZero(argvPlan.runOperator, { cwd });
    track('container', argvPlan.names.operatorContainer);

    // Inspect
    const mcpInspect = await spawnFileExpectZero(argvPlan.inspectContainer(argvPlan.names.mcpContainer), { cwd });
    const opInspect = await spawnFileExpectZero(argvPlan.inspectContainer(argvPlan.names.operatorContainer), { cwd });
    const mcpImgInspect = await spawnFileExpectZero(argvPlan.inspectImage(argvPlan.names.mcpImage), { cwd });
    const opImgInspect = await spawnFileExpectZero(argvPlan.inspectImage(argvPlan.names.operatorImage), { cwd });

    // Parse MCP state from inspect output (Cmd JSON, State JSON, PortBindings JSON space-separated)
    const mcpInspectRaw = mcpInspect.stdout.trim();
    // Use docker inspect full JSON for reliable State.Running / Path / Args
    const mcpFull = await spawnFileExpectZero(
      ['docker', 'inspect', argvPlan.names.mcpContainer],
      { cwd },
    );
    const mcpFullJson = JSON.parse(mcpFull.stdout)[0];
    if (mcpFullJson.State?.Running !== true) {
      throw new Error('MCP container State.Running !== true');
    }
    if (mcpFullJson.Path !== 'node') {
      throw new Error(`MCP Path expected node got ${mcpFullJson.Path}`);
    }
    const args = mcpFullJson.Args ?? [];
    if (JSON.stringify(args) !== JSON.stringify(['apps/mcp-server/dist/index.mjs'])) {
      throw new Error(`MCP Args mismatch: ${JSON.stringify(args)}`);
    }
    const opFull = await spawnFileExpectZero(
      ['docker', 'inspect', argvPlan.names.operatorContainer],
      { cwd },
    );
    const opFullJson = JSON.parse(opFull.stdout)[0];
    if (JSON.stringify(opFullJson.Config?.Cmd) !== JSON.stringify(['node', 'apps/operator-console/dist/server.mjs'])) {
      throw new Error(`operator Cmd mismatch: ${JSON.stringify(opFullJson.Config?.Cmd)}`);
    }

    atomicWrite(join(cfg.evidenceDir, 'container-inspect.json'), {
      mcp: { format: mcpInspectRaw, full: mcpFullJson },
      operator: { format: opInspect.stdout.trim(), full: opFullJson },
      images: {
        mcp: mcpImgInspect.stdout.trim(),
        operator: opImgInspect.stdout.trim(),
      },
    });

    // Health + auth
    const health = await pollHealth(cfg.leasedWebPort, 30_000);
    atomicWrite(join(cfg.evidenceDir, 'health-response.json'), health);
    const auth = await assertUnauthenticatedMutationDenied(cfg.leasedWebPort);
    atomicWrite(join(cfg.evidenceDir, 'auth-mutation-response.json'), auth);

    atomicWrite(join(cfg.evidenceDir, 'receipt.json'), {
      taskRunId: cfg.taskRunId,
      leasedWebPort: cfg.leasedWebPort,
      health,
      auth,
      names: argvPlan.names,
      ok: true,
    });

    await finalize();
  } catch (error) {
    const exitCode = error && typeof error === 'object' && 'exitCode' in error
      ? /** @type {{ exitCode?: number }} */ (error).exitCode
      : undefined;
    if (exitCode === EXIT_DOCKER_PREFLIGHT) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_DOCKER_PREFLIGHT;
      try { await cleanup(); } catch { /* ignore */ }
      return;
    }
    await finalize(error instanceof Error ? error : new Error(String(error)));
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
