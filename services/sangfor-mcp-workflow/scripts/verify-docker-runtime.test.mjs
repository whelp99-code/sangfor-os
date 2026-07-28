/**
 * Unit tests for verify-docker-runtime pieces (no live daemon required where possible).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalUnixDockerHost,
  buildDockerArgv,
  createCleanupController,
  validateEnv,
} from './verify-docker-runtime.mjs';

test('validateEnv accepts exact valid values', () => {
  const cfg = validateEnv({
    TASK_RUN_ID: 'u004-a1-deadbeef',
    LEASED_WEB_PORT: '46317',
    U004_EVIDENCE_DIR: '/tmp/U004/attempt-1/docker',
  });
  assert.equal(cfg.taskRunId, 'u004-a1-deadbeef');
  assert.equal(cfg.leasedWebPort, 46317);
});

test('validateEnv rejects DOCKER_HOST and DOCKER_CONTEXT', () => {
  assert.throws(() => validateEnv({
    TASK_RUN_ID: 'r1',
    LEASED_WEB_PORT: '46317',
    U004_EVIDENCE_DIR: '/tmp/U004/x',
    DOCKER_HOST: 'tcp://1.2.3.4:2375',
  }), /DOCKER_HOST/);
  assert.throws(() => validateEnv({
    TASK_RUN_ID: 'r1',
    LEASED_WEB_PORT: '46317',
    U004_EVIDENCE_DIR: '/tmp/U004/x',
    DOCKER_CONTEXT: 'remote',
  }), /DOCKER_CONTEXT/);
});

test('validateEnv rejects bad task id and port', () => {
  assert.throws(() => validateEnv({
    TASK_RUN_ID: 'BAD_ID',
    LEASED_WEB_PORT: '46317',
    U004_EVIDENCE_DIR: '/tmp/U004/x',
  }), /TASK_RUN_ID/);
  assert.throws(() => validateEnv({
    TASK_RUN_ID: 'ok-id',
    LEASED_WEB_PORT: '80',
    U004_EVIDENCE_DIR: '/tmp/U004/x',
  }), /LEASED_WEB_PORT/);
  assert.throws(() => validateEnv({
    TASK_RUN_ID: 'ok-id',
    LEASED_WEB_PORT: '46317',
    U004_EVIDENCE_DIR: 'relative/U004',
  }), /U004_EVIDENCE_DIR/);
});

test('buildDockerArgv matches dispatch byte-precise arrays', () => {
  const r = 'u004-a1-abc12345';
  const p = 46317;
  const plan = buildDockerArgv(r, p);

  assert.deepEqual(plan.preflight.contextInspect, [
    'docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}',
  ]);
  assert.deepEqual(plan.preflight.info, [
    'docker', 'info', '--format', '{{json .ServerVersion}}',
  ]);
  assert.deepEqual(plan.networkCreate, [
    'docker', 'network', 'create',
    '--label', `com.sangfor.refactor.run=${r}`,
    '--label', 'com.sangfor.refactor.unit=U004',
    `sangfor-u004-${r}`,
  ]);
  assert.deepEqual(plan.buildMcp, [
    'docker', 'build', '--pull=false',
    '--file', 'apps/mcp-server/Dockerfile',
    '--tag', `sangfor-workflow-mcp:${r}`,
    '--label', `com.sangfor.refactor.run=${r}`,
    '--label', 'com.sangfor.refactor.unit=U004',
    '.',
  ]);
  assert.deepEqual(plan.buildOperator, [
    'docker', 'build', '--pull=false',
    '--file', 'apps/operator-console/Dockerfile',
    '--tag', `sangfor-workflow-operator:${r}`,
    '--label', `com.sangfor.refactor.run=${r}`,
    '--label', 'com.sangfor.refactor.unit=U004',
    '.',
  ]);
  assert.deepEqual(plan.runMcp, [
    'docker', 'run', '--detach', '--interactive',
    '--name', `sangfor-u004-mcp-${r}`,
    '--label', `com.sangfor.refactor.run=${r}`,
    '--label', 'com.sangfor.refactor.unit=U004',
    '--network', `sangfor-u004-${r}`,
    '--env', 'NODE_ENV=production',
    '--env', `MCP_API_KEY=u004-local-fixture-${r}`,
    '--env', `SANGFOR_OPERATOR_PRINCIPAL_ID=u004-operator-${r}`,
    `sangfor-workflow-mcp:${r}`,
  ]);
  assert.deepEqual(plan.runOperator, [
    'docker', 'run', '--detach',
    '--name', `sangfor-u004-operator-${r}`,
    '--label', `com.sangfor.refactor.run=${r}`,
    '--label', 'com.sangfor.refactor.unit=U004',
    '--network', `sangfor-u004-${r}`,
    '--publish', `127.0.0.1:${p}:3500`,
    '--env', 'NODE_ENV=production',
    '--env', 'PORT=3500',
    '--env', `SANGFOR_API_KEY=u004-local-fixture-${r}`,
    '--env', `SANGFOR_OPERATOR_PRINCIPAL_ID=u004-operator-${r}`,
    `sangfor-workflow-operator:${r}`,
  ]);
  assert.deepEqual(
    plan.inspectContainer(`sangfor-u004-mcp-${r}`),
    [
      'docker', 'inspect',
      '--format', '{{json .Config.Cmd}} {{json .State}} {{json .HostConfig.PortBindings}}',
      `sangfor-u004-mcp-${r}`,
    ],
  );
  assert.deepEqual(
    plan.inspectImage(`sangfor-workflow-mcp:${r}`),
    [
      'docker', 'image', 'inspect',
      '--format', '{{json .Config.Cmd}} {{json .Config.Labels}}',
      `sangfor-workflow-mcp:${r}`,
    ],
  );
  assert.deepEqual(plan.rmContainer(`sangfor-u004-mcp-${r}`), [
    'docker', 'rm', '--force', `sangfor-u004-mcp-${r}`,
  ]);
  assert.deepEqual(plan.rmNetwork, ['docker', 'network', 'rm', `sangfor-u004-${r}`]);
  assert.deepEqual(plan.rmImage(`sangfor-workflow-mcp:${r}`), [
    'docker', 'image', 'rm', '--force', `sangfor-workflow-mcp:${r}`,
  ]);
});

test('assertLocalUnixDockerHost accepts unix socket JSON', () => {
  assert.equal(
    assertLocalUnixDockerHost('"unix:///var/run/docker.sock"'),
    'unix:///var/run/docker.sock',
  );
  assert.throws(
    () => assertLocalUnixDockerHost('"tcp://1.2.3.4:2375"'),
    (err) => err.exitCode === 64,
  );
});

test('cleanup controller is idempotent and only cleans tracked resources', async () => {
  const trueBin = process.platform === 'darwin' ? '/usr/bin/true' : '/bin/true';
  const plan = {
    names: {},
    rmContainer: (c) => [trueBin, c],
    rmNetwork: [trueBin, 'net'],
    rmImage: (i) => [trueBin, i],
    residueContainers: [trueBin],
    residueImages: [trueBin],
    residueNetworks: [trueBin],
  };
  const { track, cleanup } = createCleanupController(plan, process.cwd());
  track('container', 'c1');
  track('image', 'i1');
  track('network', 'n1');
  const first = await cleanup();
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  const second = await cleanup();
  assert.equal(second.already, true);
});
