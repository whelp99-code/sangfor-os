#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const STARTING_SHA = "7026e9e27e6d21ae1376f27ca51f35de3a240cfe";
const AUTHORITY_BODY_SHA256 = "0adee3cb747f05a09f678aa22a909393c387248f99875bc00979141c8b596286";
const DISPATCH_SHA256 = "832789e9cb93e08a7a0708f75106b1dc0b9d9bd4a3558fdce9428634fb52e841";
const GATE36_SECTION_SHA256 = "570a71fc4a47cdf4cbb82339354b9b81759bb6b9876ddd02e6f41ab592e32345";
const GATE37_SECTION_SHA256 = "e8a2f2574e61269597c717d622c2d7766feb1e354b614a2bf34798c436af2983";
const GATE38_SECTION_SHA256 = "c68dd0b7e7e2adc25aed7c0d7fc6d93bbdce2a4fb2b0b0680d3e7bdb1bf4f331";
const GATE39_SECTION_SHA256 = "c958b0c824501f38257036dff426214471986dbf1073b0cb7284d2a3104ba436";
const GATE40_SECTION_SHA256 = "a0952272f05a237bf5b688835a5c8ecf53cf01a27f4f925b5e950f526910f276";
const GATE41_SECTION_SHA256 = "a5ec2720b1bb65ed659092f808a434fe05a460261d271eecd9a4762f59fac57d";
const LEGACY_ATTEMPT2_DISPATCHER_SNAPSHOT_SHA256 = "792679bd0b58ed762f36654bfcfaa92cda1731ba0fab1d36c814b1325608e791";
const LEGACY_ATTEMPT2_DISPATCHER_SNAPSHOT_BYTES = 5507;
const LEGACY_ATTEMPT2_RUN_ID = "8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8";
const IPC_PROTOCOL = "u002-containment-ipc/v1";
const FINALIZER_CLOCK_PROBE_PREFIX = ".u002-finalizer-clock-";
const DARWIN_DIR_FD_PYTHON = "/usr/bin/python3";
const DARWIN_DIR_FD_CAPABILITIES = [
  "listdir-fd",
  "open-dir-fd",
  "rmdir-dir-fd",
  "stat-dir-fd-no-follow",
  "link-dir-fd-no-follow",
  "unlink-dir-fd",
];
const DARWIN_DIR_FD_HELPER_SOURCE = String.raw`
from __future__ import annotations

import base64
import binascii
import errno
import json
import os
import stat
import sys

ROOT_FD = 3
CAPABILITIES = [
    "listdir-fd",
    "open-dir-fd",
    "rmdir-dir-fd",
    "stat-dir-fd-no-follow",
    "link-dir-fd-no-follow",
    "unlink-dir-fd",
]
NAME_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


class ProtocolError(Exception):
    pass


def emit(op, ok, result=None, error=None):
    payload = {"error": error, "ok": ok, "op": op, "result": result}
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n")


def require_request(request, op, keys):
    if not isinstance(request, dict) or set(request) != keys or request.get("op") != op:
        raise ProtocolError()


def child_name(value):
    if (
        not isinstance(value, str)
        or not value
        or value in {".", ".."}
        or len(value.encode("utf-8")) > 255
        or any(character not in NAME_CHARS for character in value)
    ):
        raise ProtocolError()
    return value


def metadata(value):
    return {
        "dev": str(value.st_dev),
        "ino": str(value.st_ino),
        "mode": str(value.st_mode),
        "nlink": str(value.st_nlink),
        "size": str(value.st_size),
    }


def root_metadata():
    value = os.fstat(ROOT_FD)
    if not stat.S_ISDIR(value.st_mode):
        raise ProtocolError()
    return value


def handle_capabilities(request):
    require_request(request, "capabilities", {"op"})
    root = root_metadata()
    required_dir_fd = (os.open, os.link, os.stat, os.unlink, os.rmdir)
    if (
        not all(function in os.supports_dir_fd for function in required_dir_fd)
        or os.listdir not in os.supports_fd
        or not hasattr(os, "O_NOFOLLOW")
        or not hasattr(os, "O_DIRECTORY")
    ):
        raise ProtocolError()
    return {
        "capabilities": CAPABILITIES,
        "executable": os.path.realpath(sys.executable),
        "root": metadata(root),
        "version": list(sys.version_info[:3]),
    }


def handle_stat(request):
    require_request(request, "stat", {"name", "op"})
    root_metadata()
    name = child_name(request["name"])
    try:
        value = os.stat(name, dir_fd=ROOT_FD, follow_symlinks=False)
    except FileNotFoundError:
        return {"exists": False, "metadata": None}
    return {"exists": True, "metadata": metadata(value)}


def handle_write(request):
    require_request(request, "write", {"data", "name", "op"})
    root_metadata()
    name = child_name(request["name"])
    if not isinstance(request["data"], str):
        raise ProtocolError()
    data = base64.b64decode(request["data"].encode("ascii"), validate=True)
    if len(data) > 4 * 1024 * 1024:
        raise ProtocolError()
    descriptor = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=ROOT_FD,
    )
    try:
        remaining = memoryview(data)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError(errno.EIO, "write")
            remaining = remaining[written:]
        os.fsync(descriptor)
        value = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    return {"metadata": metadata(value)}


def handle_link(request):
    require_request(request, "link", {"destination", "op", "source"})
    root_metadata()
    source = child_name(request["source"])
    destination = child_name(request["destination"])
    os.link(
        source,
        destination,
        src_dir_fd=ROOT_FD,
        dst_dir_fd=ROOT_FD,
        follow_symlinks=False,
    )
    return {"linked": True}


def handle_unlink(request):
    require_request(request, "unlink", {"name", "op"})
    root_metadata()
    name = child_name(request["name"])
    try:
        os.unlink(name, dir_fd=ROOT_FD)
    except FileNotFoundError:
        return {"removed": False}
    return {"removed": True}


def handle_fsync(request):
    require_request(request, "fsync", {"op"})
    root_metadata()
    os.fsync(ROOT_FD)
    return {"synced": True}


def remove_entry(parent_fd, name):
    value = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if stat.S_ISDIR(value.st_mode):
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
        try:
            for child in os.listdir(descriptor):
                remove_entry(descriptor, child)
        finally:
            os.close(descriptor)
        os.rmdir(name, dir_fd=parent_fd)
        return
    os.unlink(name, dir_fd=parent_fd)


def handle_remove_tree(request):
    require_request(request, "remove_tree", {"expectedDev", "expectedIno", "name", "op"})
    root_metadata()
    name = child_name(request["name"])
    expected_dev = request["expectedDev"]
    expected_ino = request["expectedIno"]
    if (
        not isinstance(expected_dev, str)
        or not expected_dev.isdecimal()
        or not isinstance(expected_ino, str)
        or not expected_ino.isdecimal()
    ):
        raise ProtocolError()
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=ROOT_FD,
        )
    except FileNotFoundError:
        return {"identityMatched": False, "removed": False}
    try:
        owned = os.fstat(descriptor)
        if owned.st_dev != int(expected_dev) or owned.st_ino != int(expected_ino):
            return {"identityMatched": False, "removed": False}
        for child in os.listdir(descriptor):
            remove_entry(descriptor, child)
        try:
            current = os.stat(name, dir_fd=ROOT_FD, follow_symlinks=False)
        except FileNotFoundError:
            return {"identityMatched": False, "removed": False}
        if current.st_dev != owned.st_dev or current.st_ino != owned.st_ino:
            return {"identityMatched": False, "removed": False}
        os.rmdir(name, dir_fd=ROOT_FD)
        return {"identityMatched": True, "removed": True}
    finally:
        os.close(descriptor)


HANDLERS = {
    "capabilities": handle_capabilities,
    "fsync": handle_fsync,
    "link": handle_link,
    "remove_tree": handle_remove_tree,
    "stat": handle_stat,
    "unlink": handle_unlink,
    "write": handle_write,
}


def main():
    op = "invalid"
    try:
        request_bytes = sys.stdin.buffer.read()
        request = json.loads(request_bytes)
        canonical_request = (
            json.dumps(request, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
        ).encode("ascii")
        if request_bytes != canonical_request:
            raise ProtocolError()
        if not isinstance(request, dict) or not isinstance(request.get("op"), str):
            raise ProtocolError()
        op = request["op"]
        handler = HANDLERS.get(op)
        if handler is None:
            raise ProtocolError()
        result = handler(request)
    except (ProtocolError, UnicodeError, json.JSONDecodeError, binascii.Error):
        emit(op, False, error="EPROTO")
        return 64
    except OSError as error:
        emit(op, False, error=errno.errorcode.get(error.errno, "EUNKNOWN"))
        return 74
    emit(op, True, result=result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_NAMES = [
  "web",
  "api",
  "workflow-operator",
  "engineer-bridge",
  "engineer-operator",
];
const IDENTITY_FIELD_NAMES = [
  "approvedBy",
  "actorId",
  "requestedBy",
  "requester",
  "approver",
  "approverId",
  "approverPersonaId",
  "personaId",
];

export const READ_ONLY = [
  "packages/agent/src/adapters.ts",
  "packages/db/package.json",
  "services/sangfor-mcp-workflow/packages/wiki-sync/src/github-wiki-sync.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/index.ts",
  "services/sangfor-engineer-mcp/package.json",
  "services/sangfor-engineer-mcp/pnpm-lock.yaml",
  "services/sangfor-mcp-workflow/package.json",
  "services/sangfor-mcp-workflow/pnpm-lock.yaml",
];

export const MODIFY = [
  "apps/web/src/app/api/auth/login/route.ts",
  "apps/web/src/lib/auth/config.ts",
  "apps/web/src/lib/auth/session.ts",
  "apps/web/src/lib/api-auth.ts",
  "apps/web/src/lib/auth/session.test.ts",
  "apps/web/src/lib/api-auth.test.ts",
  "apps/web/src/app/api/finance/[...path]/route.ts",
  "apps/web/src/app/api/mcp/tools/route.ts",
  "apps/web/src/app/api/finance/[...path]/route.test.ts",
  "apps/web/src/app/api/mcp/tools/route.test.ts",
  "apps/web/next-env.d.ts",
  "apps/api/src/index.ts",
  "apps/api/src/index.test.ts",
  "packages/infra/src/mcp-client.ts",
  "packages/infra/src/mcp-client.test.ts",
  "apps/api/src/middleware/auth.ts",
  "apps/api/src/middleware/api-key.ts",
  "apps/api/src/routes/cfo.ts",
  "apps/api/src/services/finance/codef.service.ts",
  "apps/api/src/services/finance/popbill.service.ts",
  "packages/auth/src/auth-context.ts",
  "packages/auth/src/auth-context.test.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/index.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/bootstrap/mcp-bootstrap.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/middleware/auth.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/server.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/public/app.js",
  "services/sangfor-mcp-workflow/apps/operator-console/tests/health-api.test.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/approval-manager.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/breakglass-policy.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/device-access-manager.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/mcp-client.ts",
  "services/sangfor-mcp-workflow/packages/workflow-engine/src/workflow-executor.ts",
  "services/sangfor-mcp-workflow/scripts/run-auto-ops-device-e2e.ts",
  "services/sangfor-mcp-workflow/scripts/run-mcp-phase2.mjs",
  "services/sangfor-mcp-workflow/scripts/run-wiki-sync.ts",
  "services/sangfor-mcp-workflow/tests/workflow-engine.test.ts",
  "services/sangfor-mcp-workflow/vitest.config.ts",
  "services/sangfor-engineer-mcp/apps/http-bridge/src/server.ts",
  "services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
  "services/sangfor-engineer-mcp/apps/operator-console/src/server.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-operator/src/index.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts",
  "services/sangfor-engineer-mcp/tests/product-adapters.test.ts",
  "packages/business/src/infrastructure/github-connector.ts",
  "packages/business/src/infrastructure/action-connector-runtime.ts",
  "packages/business/src/infrastructure/action-connector-runtime.test.ts",
  "scripts/live-approval-smoke.mjs",
  "scripts/restore-db.sh",
  "package.json",
  "packages/db/scripts/cfo-restore.ts",
  ".env.example",
  "apps/web/.env.example",
  "apps/api/.env.example",
  "services/sangfor-engineer-mcp/.env.example",
  "services/sangfor-mcp-workflow/.env.example",
  "apps/web/AGENTS.md",
];

export const CREATE = [
  "apps/web/src/lib/auth/runtime-profile.ts",
  "apps/web/src/app/api/auth/login/route.test.ts",
  "apps/api/src/middleware/auth.test.ts",
  "apps/api/src/middleware/api-key.test.ts",
  "services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/server-context.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/routes/system-routes.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/routes/workflow-routes.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/src/routes/auto-ops-routes.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/tests/auth-containment.test.ts",
  "services/sangfor-mcp-workflow/apps/operator-console/tests/server-split-regression.test.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tool-types.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tool-context.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tool-catalog.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/json-rpc-handler.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tools/workflow-tools.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tools/integration-tools.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tools/operation-tools.ts",
  "services/sangfor-mcp-workflow/apps/mcp-server/src/tool-catalog.test.ts",
  "services/sangfor-engineer-mcp/packages/shared/src/mutation-policy.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/adapter-types.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/adapter-catalog.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/excel-requirements.ts",
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/change-execution.ts",
  "services/sangfor-engineer-mcp/tests/mutation-containment.test.ts",
  "packages/business/src/governance/external-mutation-containment.ts",
  "packages/business/src/infrastructure/external-mutation-containment.test.ts",
  "apps/api/src/services/finance/external-mutation-containment.test.ts",
  "scripts/restore-db.test.mjs",
  "scripts/check-u002-containment-surface.mjs",
  "scripts/check-u002-containment-surface.test.mjs",
];

const BOOTSTRAP_CREATE = [
  "scripts/check-u002-containment-surface.mjs",
  "scripts/check-u002-containment-surface.test.mjs",
];

export const OWNED_PATHS = [...READ_ONLY, ...MODIFY, ...CREATE];

const PREFLIGHT_LOG_PATHS = ["workflow-operator", "workflow-mcp"].flatMap((entrypoint) => (
  ["MCP_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID", "WHELP99_ENFORCE_SAFE_TOOLS"]
    .flatMap((field) => ["missing", "blank"].flatMap((variant) => {
      const prefix = `real-surface/logs/preflight-${entrypoint}-${field.toLowerCase()}-${variant}`;
      return [`${prefix}.stdout.log`, `${prefix}.stderr.log`];
    }))
));
const SERVICE_LOG_PATHS = SERVICE_NAMES.flatMap((name) => [
  `real-surface/logs/${name}.stdout.log`,
  `real-surface/logs/${name}.stderr.log`,
]);
const SUPPORT_LOG_PATHS = [
  "real-surface/logs/workflow-mcp-probe.stdout.log",
  "real-surface/logs/workflow-mcp-probe.stderr.log",
  "real-surface/logs/engineer-mcp-probe.stdout.log",
  "real-surface/logs/engineer-mcp-probe.stderr.log",
  "real-surface/logs/web-build.stdout.log",
  "real-surface/logs/web-build.stderr.log",
];
const FINALIZATION_LOG_PATHS = bytewiseSorted([
  ...PREFLIGHT_LOG_PATHS,
  ...SERVICE_LOG_PATHS,
  ...SUPPORT_LOG_PATHS,
]);

const FINALIZATION_REQUEST_NAMES = bytewiseSorted([
  "workflow-mcp-probe-unauthenticated",
  "engineer-mcp-probe-unauthenticated",
  "web-login-missing-secret",
  "api-bypass-header-denied",
  "api-tools-finance-forbidden",
  ...IDENTITY_FIELD_NAMES.flatMap((field) => ["root", "object", "array"].map(
    (location) => `api-tools-identity-conflict-${field}-${location}`,
  )),
  "workflow-operator-health-not-ready",
  "workflow-operator-health-ready",
  "engineer-bridge-health-not-ready",
  "engineer-bridge-health-ready",
  "engineer-operator-health-not-ready",
  "engineer-operator-health-ready",
  "api-cfo-missing-key",
  "api-cfo-wrong-key",
  "workflow-config-missing-key",
  "workflow-config-wrong-key",
  "engineer-bridge-tools-missing-key",
  "engineer-bridge-tools-wrong-key",
  "engineer-operator-summary-missing-key",
  "engineer-operator-summary-wrong-key",
  "api-tools-shared-key-positive",
  "api-tools-call-shared-key-positive",
  "engineer-bridge-equal-identity-positive",
  "api-finance-context-forbidden",
  "api-spoofed-actor",
  "api-external-finance-contained",
  "workflow-spoofed-approver",
  "engineer-bridge-spoofed-actor",
  "engineer-bridge-mutation-contained",
  "engineer-operator-spoofed-actor",
  "workflow-breakglass-contained",
]);
const FINALIZATION_REQUEST_PATHS = FINALIZATION_REQUEST_NAMES.map(
  (name) => `real-surface/requests/${name}.json`,
);
const FINALIZATION_BASE_ARTIFACT_PATHS = [
  "negative-matrix.json",
  "side-effect-spies.json",
  "restore-refusal.txt",
  "readiness-workflow-focused.log",
  "readiness-engineer-focused.log",
  "post-gate32-business-focused.log",
  "focused-evidence-index.json",
  "generated-pptx/Sangfor_설정가이드_MCP.pptx",
  "source-integrity-before.json",
  "source-integrity-after.json",
  "real-surface/processes.json",
  "real-surface/web-env-read-audit.json",
  "real-surface/observed-counters.json",
  "real-surface/cleanup.json",
  "real-surface/runner-tmpdir.json",
  "real-surface/unsafe-configuration-preflight.json",
  "real-surface/mcp-negative-surface.json",
  "real-surface/port-preflight.json",
  "real-surface/web-build.json",
  "real-surface/captures/api-to-infra.json",
  "real-surface/captures/bridge-to-child.json",
  "real-surface/result.json",
  "surface-qa.md",
];
export const FINALIZATION_ARTIFACT_PATHS = bytewiseSorted([
  ...FINALIZATION_BASE_ARTIFACT_PATHS,
  ...FINALIZATION_LOG_PATHS,
  ...FINALIZATION_REQUEST_PATHS,
]);
const FINALIZATION_CONTROL_PATHS = [
  "finalization-manifest.json",
  "surface-qa-review.md",
  "final-code-review.md",
  "review-handoffs/surface-qa.json",
  "review-handoffs/final-code.json",
  "receipt.json",
];
export const RUNNER_OWNED_OUTPUT_PATHS = bytewiseSorted([
  ...FINALIZATION_ARTIFACT_PATHS,
  ...FINALIZATION_CONTROL_PATHS,
]);
const RUNNER_FORBIDDEN_CONTROL_PATHS = ["dispatcher/snapshot.json"];

const LARGE_FILE_BASELINE = {
  "services/sangfor-mcp-workflow/apps/operator-console/src/server.ts": 1169,
  "services/sangfor-mcp-workflow/apps/mcp-server/src/index.ts": 876,
  "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts": 1004,
};

const ENTRYPOINT_PROBES = [
  {
    category: "auth-bypass",
    path: "apps/web/src/app/api/auth/login/route.ts",
    pattern: /mock\.session/,
  },
  {
    category: "auth-bypass",
    path: "apps/api/src/middleware/auth.ts",
    pattern: /AUTH_BYPASS_ENABLED/,
  },
  {
    category: "auth-bypass",
    path: "apps/api/src/middleware/api-key.ts",
    pattern: /AUTH_BYPASS_ENABLED/,
  },
  {
    category: "auth-bypass",
    path: "apps/web/src/lib/api-auth.ts",
    pattern: /AUTH_BYPASS_ENABLED/,
  },
  {
    category: "auth-bypass",
    path: "services/sangfor-engineer-mcp/apps/http-bridge/src/server.ts",
    pattern: /WHELP99_ENFORCE_SAFE_TOOLS/,
  },
  {
    category: "caller-identity",
    path: "services/sangfor-mcp-workflow/apps/mcp-server/src/index.ts",
    pattern: /args\.(?:approvedBy|requestedBy)/,
  },
  {
    category: "caller-identity",
    path: "services/sangfor-mcp-workflow/apps/operator-console/src/server.ts",
    pattern: /req\.body(?:\?\.)?\.(?:approvedBy|requestedBy)|\{[^}]*requestedBy[^}]*\}\s*=\s*req\.body/s,
  },
  {
    category: "caller-identity",
    path: "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts",
    pattern: /input\.approval\?\.approvedBy/,
  },
  {
    category: "live-execute",
    path: "services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
    pattern: /handler:\s*(?:applyApprovedProductChange|executeLiveConsoleAction)/,
  },
  {
    category: "live-execute",
    path: "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts",
    pattern: /await executeLiveConsoleAction/,
  },
  {
    category: "external-write-sync",
    path: "packages/business/src/infrastructure/github-connector.ts",
    pattern: /createPullRequestForRun/,
  },
  {
    category: "external-write-sync",
    path: "apps/api/src/services/finance/popbill.service.ts",
    pattern: /popbill/i,
  },
  {
    category: "external-write-sync",
    path: "apps/api/src/services/finance/codef.service.ts",
    pattern: /codef/i,
  },
  {
    category: "external-write-sync",
    path: "services/sangfor-mcp-workflow/scripts/run-wiki-sync.ts",
    pattern: /wiki/i,
  },
  {
    category: "direct-restore",
    path: "package.json",
    pattern: /"cfo:restore"/,
  },
  {
    category: "direct-restore",
    path: "packages/db/package.json",
    pattern: /"cfo:restore"/,
  },
  {
    category: "direct-restore",
    path: "packages/db/scripts/cfo-restore.ts",
    pattern: /cfo:restore/,
  },
  {
    category: "direct-restore",
    path: "scripts/restore-db.sh",
    pattern: /psql/,
  },
];

const IMPLEMENTED_ENTRYPOINT_RULES = [
  {
    id: "auth-bypass-control",
    category: "auth-bypass",
    pattern: /\b(?:AUTH_BYPASS_ENABLED|API_KEY_BYPASS_ENABLED|API_KEY_AUTH_BYPASS_ENABLED|MCP_API_KEY_BYPASS_ENABLED|AUTH_PROFILE|WHELP99_ENFORCE_SAFE_TOOLS)\b/u,
  },
  {
    id: "caller-identity-field",
    category: "caller-identity",
    pattern: /\b(?:approvedBy|actorId|requestedBy|requester|approver|approverId|approverPersonaId|personaId)\b/u,
  },
  {
    id: "live-console-executor",
    category: "live-execute",
    pattern: /\bexecuteLiveConsoleAction\b/u,
  },
  {
    id: "product-change-executor",
    category: "live-execute",
    pattern: /\bapplyApprovedProductChange\b/u,
  },
  {
    id: "github-external-write",
    category: "external-write-sync",
    pattern: /\bcreatePullRequestForRun\b/u,
  },
  {
    id: "popbill-external-write",
    category: "external-write-sync",
    pattern: /popbill/iu,
  },
  {
    id: "codef-external-write",
    category: "external-write-sync",
    pattern: /codef/iu,
  },
  {
    id: "wiki-external-sync",
    category: "external-write-sync",
    pattern: /wiki|obsidian/iu,
  },
  {
    id: "direct-restore",
    category: "direct-restore",
    pattern: /cfo:restore|\bpsql\b|DIRECT_RESTORE_QUARANTINED_USE_U009/u,
  },
];

function isImplementedEntrypointScanPath(path) {
  if (/\.test\.[cm]?[jt]sx?$/u.test(path) || path.includes("/tests/")) return false;
  if (/(?:^|\/)vitest\.config\.[cm]?[jt]s$/u.test(path)) return false;
  if (path.endsWith(".env.example") || path.endsWith("AGENTS.md")) return false;
  if (path.endsWith("pnpm-lock.yaml") || path.endsWith("next-env.d.ts")) return false;
  if (path === "scripts/check-u002-containment-surface.mjs") return false;
  return /(?:\.[cm]?[jt]sx?|\.json|\.sh)$/u.test(path);
}

export const IMPLEMENTED_ENTRYPOINT_SCAN_PATHS = sorted(
  [...READ_ONLY, ...MODIFY, ...CREATE].filter(isImplementedEntrypointScanPath),
);

const IMPLEMENTED_ENTRYPOINT_EXPECTED_KEYS = [
  "auth-bypass-control:apps/api/src/middleware/api-key.ts",
  "auth-bypass-control:apps/api/src/middleware/auth.ts",
  "auth-bypass-control:apps/web/src/lib/api-auth.ts",
  "auth-bypass-control:apps/web/src/lib/auth/runtime-profile.ts",
  "auth-bypass-control:services/sangfor-engineer-mcp/packages/shared/src/mutation-policy.ts",
  "auth-bypass-control:services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts",
  "caller-identity-field:apps/web/src/lib/api-auth.ts",
  "caller-identity-field:packages/auth/src/auth-context.ts",
  "caller-identity-field:services/sangfor-engineer-mcp/packages/sangfor-operator/src/index.ts",
  "caller-identity-field:services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/adapter-types.ts",
  "caller-identity-field:services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/change-execution.ts",
  "caller-identity-field:services/sangfor-engineer-mcp/packages/shared/src/mutation-policy.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/apps/mcp-server/src/tools/operation-tools.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/apps/mcp-server/src/tools/workflow-tools.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/apps/operator-console/src/routes/auto-ops-routes.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/apps/operator-console/src/routes/workflow-routes.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/packages/workflow-engine/src/approval-manager.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/packages/workflow-engine/src/breakglass-policy.ts",
  "caller-identity-field:services/sangfor-mcp-workflow/packages/workflow-engine/src/device-access-manager.ts",
  "codef-external-write:apps/api/src/routes/cfo.ts",
  "codef-external-write:apps/api/src/services/finance/codef.service.ts",
  "direct-restore:packages/db/package.json",
  "github-external-write:packages/business/src/infrastructure/github-connector.ts",
  "live-console-executor:services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
  "live-console-executor:services/sangfor-engineer-mcp/packages/sangfor-operator/src/index.ts",
  "live-console-executor:services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/change-execution.ts",
  "popbill-external-write:apps/api/src/routes/cfo.ts",
  "popbill-external-write:apps/api/src/services/finance/popbill.service.ts",
  "product-change-executor:services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
  "product-change-executor:services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/change-execution.ts",
  "product-change-executor:services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts",
  "wiki-external-sync:services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
  "wiki-external-sync:services/sangfor-engineer-mcp/package.json",
  "wiki-external-sync:services/sangfor-mcp-workflow/apps/mcp-server/src/tools/integration-tools.ts",
  "wiki-external-sync:services/sangfor-mcp-workflow/package.json",
  "wiki-external-sync:services/sangfor-mcp-workflow/packages/wiki-sync/src/github-wiki-sync.ts",
  "wiki-external-sync:services/sangfor-mcp-workflow/scripts/run-wiki-sync.ts",
];

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function existsAtRevision(path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${STARTING_SHA}:${path}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function loadTypeScript() {
  const require = createRequire(import.meta.url);
  return require("typescript");
}

function executableRuleSource(path, source) {
  if (/\.(?:ts|tsx|js|mjs)$/u.test(path)) {
    const ts = loadTypeScript();
    const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".ts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const lexemes = [];
    const isIdentityArrayElement = (node) => {
      if (!ts.isArrayLiteralExpression(node.parent)) return false;
      let declaration = node.parent.parent;
      while (
        ts.isAsExpression(declaration)
        || ts.isSatisfiesExpression(declaration)
        || ts.isNewExpression(declaration)
        || ts.isCallExpression(declaration)
        || ts.isParenthesizedExpression(declaration)
      ) {
        declaration = declaration.parent;
      }
      return ts.isVariableDeclaration(declaration)
        && ts.isIdentifier(declaration.name)
        && /identity/i.test(declaration.name.text);
    };
    const isExecutableCallArgument = (node) => {
      if (!ts.isCallExpression(node.parent)) return false;
      const expression = node.parent.expression;
      if (ts.isPropertyAccessExpression(expression)) {
        return /^(?:get|post|put|patch|delete|use|register)$/u.test(expression.name.text);
      }
      return ts.isIdentifier(expression) && /(?:deny|contain|register|route|sync)/iu.test(expression.text);
    };
    const visit = (node) => {
      if (ts.isIdentifier(node)) lexemes.push(node.text);
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && (
          (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node)
          || ((ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent)) && node.parent.name === node)
          || isIdentityArrayElement(node)
          || isExecutableCallArgument(node)
        )
      ) lexemes.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return lexemes.join("\n");
  }
  if (path.endsWith(".sh")) {
    return source
      .split(/\r?\n/u)
      .map((line) => line.replace(/(^|\s)#.*$/u, "$1").replace(/(['"]).*?\1/gu, ""))
      .join("\n");
  }
  return source;
}

function pureLoc(path, ts) {
  const source = readFileSync(resolve(repoRoot, path), "utf8");
  const characters = [...source];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  const trivia = new Set([
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.ShebangTrivia,
    ts.SyntaxKind.ConflictMarkerTrivia,
  ]);

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (!trivia.has(token)) continue;
    for (let offset = scanner.getTokenPos(); offset < scanner.getTextPos(); offset += 1) {
      if (characters[offset] !== "\n" && characters[offset] !== "\r") characters[offset] = " ";
    }
  }

  return characters.join("").split(/\r?\n/u).filter((line) => /\S/u.test(line)).length;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function compareEntrypointHits(left, right) {
  return left.key.localeCompare(right.key, "en");
}

function entrypointHit(rule, path) {
  return {
    category: rule.category,
    key: `${rule.id}:${path}`,
    path,
    rule: rule.id,
  };
}

export function evaluateImplementedEntrypointSurface(root = repoRoot) {
  const actual = [];
  const unreadable = [];
  for (const path of IMPLEMENTED_ENTRYPOINT_SCAN_PATHS) {
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath)) {
      unreadable.push(path);
      continue;
    }
    const source = executableRuleSource(path, readFileSync(absolutePath, "utf8"));
    for (const rule of IMPLEMENTED_ENTRYPOINT_RULES) {
      if (rule.pattern.test(source)) actual.push(entrypointHit(rule, path));
    }
  }
  actual.sort(compareEntrypointHits);
  const expected = IMPLEMENTED_ENTRYPOINT_EXPECTED_KEYS.map((key) => {
    const separator = key.indexOf(":");
    const ruleId = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const rule = IMPLEMENTED_ENTRYPOINT_RULES.find((candidate) => candidate.id === ruleId);
    if (!rule) throw new Error(`Unknown implemented entrypoint rule: ${ruleId}`);
    return entrypointHit(rule, path);
  }).sort(compareEntrypointHits);
  const actualKeys = new Set(actual.map((hit) => hit.key));
  const expectedKeys = new Set(expected.map((hit) => hit.key));
  const added = actual.filter((hit) => !expectedKeys.has(hit.key));
  const removed = expected.filter((hit) => !actualKeys.has(hit.key));
  const exact = added.length === 0 && removed.length === 0 && unreadable.length === 0;
  return {
    exact,
    verdict: exact ? "PASS" : "PLAN_DRIFT_U002_SURFACE",
    exitCode: exact ? 0 : 65,
    actual,
    expected,
    added,
    removed,
    unreadable: sorted(unreadable),
  };
}

function changedPaths() {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path);
}

function isProductionSource(path) {
  return /\.(?:ts|js|mjs)$/u.test(path)
    && !/(?:^|\/)tests?\//u.test(path)
    && !/\.test\./u.test(path)
    && !/(?:^|\/)scripts\//u.test(path);
}

function assertImplementedContainment(errors) {
  const login = readFileSync(resolve(repoRoot, "apps/web/src/app/api/auth/login/route.ts"), "utf8");
  if (!/isLocalMockAuthProfile/u.test(login) || !/AUTH_CONFIGURATION_UNAVAILABLE/u.test(login)) {
    errors.push("Web login does not gate the local fixture profile or fail closed");
  }

  const apiIndex = readFileSync(resolve(repoRoot, "apps/api/src/index.ts"), "utf8");
  if (!/process\.env\.HOST/u.test(apiIndex) || !/app\.listen\([^,]+,\s*HOST/u.test(apiIndex)) {
    errors.push("API listener does not pass the configured loopback host explicitly");
  }

  const rootManifest = readFileSync(resolve(repoRoot, "package.json"), "utf8");
  if (/"cfo:restore"\s*:/u.test(rootManifest)) errors.push("root cfo:restore entry still exists");

  const tombstoneCode = "DIRECT_RESTORE_QUARANTINED_USE_U009";
  const restoreTypeScript = readFileSync(resolve(repoRoot, "packages/db/scripts/cfo-restore.ts"), "utf8");
  const restoreShell = readFileSync(resolve(repoRoot, "scripts/restore-db.sh"), "utf8");
  if (!restoreTypeScript.includes(tombstoneCode) || !restoreShell.includes(tombstoneCode)) {
    errors.push("restore tombstone code mismatch");
  }
  if (/^\s*import\s/mu.test(restoreTypeScript)
    || /process\.(?:env|argv)/u.test(restoreTypeScript)
    || /\b(?:spawn|exec|PrismaClient)\b/u.test(restoreTypeScript)) {
    errors.push("TypeScript restore tombstone reads input or opens a client");
  }
  if (/\b(?:DATABASE_URL|psql)\b/u.test(restoreShell) || /\$[@*#?0-9]/u.test(restoreShell)) {
    errors.push("shell restore tombstone reads input or resolves psql");
  }

  const requiredContainmentImports = [
    ["packages/business/src/infrastructure/github-connector.ts", /external-mutation-containment/u],
    ["packages/business/src/infrastructure/action-connector-runtime.ts", /external-mutation-containment/u],
    ["apps/api/src/services/finance/codef.service.ts", /denyExternalFinanceMutation/u],
    ["apps/api/src/services/finance/popbill.service.ts", /denyExternalFinanceMutation/u],
    ["services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/change-execution.ts", /mutation-policy/u],
  ];
  for (const [path, pattern] of requiredContainmentImports) {
    if (!pattern.test(readFileSync(resolve(repoRoot, path), "utf8"))) {
      errors.push(`missing containment seam: ${path}`);
    }
  }
}

function scan({ emit = true, exitOnError = true } = {}) {
  const errors = [];
  const classifications = { READ_ONLY, MODIFY, CREATE };
  const allPaths = [...READ_ONLY, ...MODIFY, ...CREATE];
  const duplicates = allPaths.filter((path, index) => allPaths.indexOf(path) !== index);
  if (duplicates.length > 0) errors.push(`ownership overlap: ${sorted(new Set(duplicates)).join(",")}`);

  if (git(["rev-parse", "HEAD"]) !== STARTING_SHA) {
    errors.push(`starting SHA mismatch: ${git(["rev-parse", "HEAD"])}`);
  }

  for (const path of [...READ_ONLY, ...MODIFY]) {
    if (!existsAtRevision(path)) errors.push(`missing at starting SHA: ${path}`);
    if (!existsSync(resolve(repoRoot, path))) errors.push(`missing from checkout: ${path}`);
  }
  for (const path of CREATE) {
    if (existsAtRevision(path)) errors.push(`CREATE existed at starting SHA: ${path}`);
  }

  const allowedChanges = new Set([...MODIFY, ...CREATE]);
  for (const path of changedPaths()) {
    if (!allowedChanges.has(path)) errors.push(`change outside U002 ownership: ${path}`);
    if (READ_ONLY.includes(path)) errors.push(`READ_ONLY path changed: ${path}`);
  }

  const currentCreate = sorted(CREATE.filter((path) => existsSync(resolve(repoRoot, path))));
  const bootstrap = sorted(BOOTSTRAP_CREATE);
  const complete = sorted(CREATE);
  const phase = JSON.stringify(currentCreate) === JSON.stringify(bootstrap)
    ? "BOOTSTRAP"
    : JSON.stringify(currentCreate) === JSON.stringify(complete)
      ? "IMPLEMENTED"
      : "INVALID";
  if (phase === "INVALID") errors.push(`partial CREATE transition: ${currentCreate.join(",")}`);

  const entrypointHits = ENTRYPOINT_PROBES.map((probe) => {
    const content = readFileSync(resolve(repoRoot, probe.path), "utf8");
    const matched = probe.pattern.test(content);
    if (phase === "BOOTSTRAP" && !matched) {
      errors.push(`missing baseline ${probe.category} hit: ${probe.path}`);
    }
    return { category: probe.category, path: probe.path, matched };
  });
  const implementedEntrypointSurface = phase === "IMPLEMENTED"
    ? evaluateImplementedEntrypointSurface(repoRoot)
    : undefined;
  if (implementedEntrypointSurface && !implementedEntrypointSurface.exact) {
    for (const hit of implementedEntrypointSurface.added) {
      errors.push(`entrypoint added: ${hit.key}`);
    }
    for (const hit of implementedEntrypointSurface.removed) {
      errors.push(`entrypoint removed or unmatched: ${hit.key}`);
    }
    for (const path of implementedEntrypointSurface.unreadable) {
      errors.push(`entrypoint path missing: ${path}`);
    }
  }

  const ts = loadTypeScript();
  const measuredLargeFiles = Object.fromEntries(
    Object.entries(LARGE_FILE_BASELINE).map(([path, expected]) => {
      const actual = pureLoc(path, ts);
      if (phase === "BOOTSTRAP" && actual !== expected) {
        errors.push(`large-file baseline mismatch: ${path} expected=${expected} actual=${actual}`);
      }
      return [path, actual];
    }),
  );

  const productionPureLoc = Object.fromEntries(
    sorted(new Set(allPaths.filter(isProductionSource).filter((path) => existsSync(resolve(repoRoot, path)))))
      .map((path) => [path, pureLoc(path, ts)]),
  );
  const filesOver800 = Object.entries(productionPureLoc)
    .filter(([, count]) => count > 800)
    .map(([path]) => path);
  const operatorServerPureLoc = productionPureLoc[
    "services/sangfor-mcp-workflow/apps/operator-console/src/server.ts"
  ];
  const workflowMcpIndexPureLoc = productionPureLoc[
    "services/sangfor-mcp-workflow/apps/mcp-server/src/index.ts"
  ];
  const productAdapterIndexPureLoc = productionPureLoc[
    "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts"
  ];
  if (phase === "IMPLEMENTED") {
    assertImplementedContainment(errors);
    if (filesOver800.length > 0) errors.push(`files over 800 pure LOC: ${filesOver800.join(",")}`);
    if (operatorServerPureLoc > 250) errors.push(`operator server pure LOC ${operatorServerPureLoc} > 250`);
    if (workflowMcpIndexPureLoc > 200) errors.push(`workflow MCP index pure LOC ${workflowMcpIndexPureLoc} > 200`);
    if (productAdapterIndexPureLoc > 80) errors.push(`product adapter index pure LOC ${productAdapterIndexPureLoc} > 80`);
  }

  const result = {
    schemaVersion: 1,
    unit: "U002",
    verdict: errors.length === 0 ? "PASS" : "PLAN_DRIFT_U002_SURFACE",
    startingSha: STARTING_SHA,
    phase,
    counts: {
      READ_ONLY: READ_ONLY.length,
      MODIFY: MODIFY.length,
      CREATE: CREATE.length,
      total: allPaths.length,
      uniqueTotal: new Set(allPaths).size,
    },
    classifications,
    currentCreate,
    entrypointHits,
    implementedEntrypointSurface,
    largeFileBaseline: LARGE_FILE_BASELINE,
    measuredLargeFiles,
    filesOver800,
    operatorServerPureLoc,
    workflowMcpIndexPureLoc,
    productAdapterIndexPureLoc,
    sizeExceptions: [],
    errors,
  };
  if (emit) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (errors.length > 0) {
    if (emit) process.stderr.write(`PLAN_DRIFT_U002_SURFACE\n${errors.join("\n")}\n`);
    if (exitOnError) process.exitCode = 65;
  }
  return result;
}

class SurfaceError extends Error {
  constructor(code, message, exitCode = 67) {
    super(`${code}: ${message}`);
    this.name = "SurfaceError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bytewiseSorted(values) {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function resolveAttemptPath(root, path) {
  if (isAbsolute(path) || path.includes("\0")) {
    throw new SurfaceError("SOURCE_MANIFEST_PATH_ESCAPE", path, 68);
  }
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const pathFromRoot = relative(absoluteRoot, absolutePath);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new SurfaceError("SOURCE_MANIFEST_PATH_ESCAPE", path, 68);
  }
  return absolutePath;
}

function sameArtifactIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertRegularSingleLink(metadata, path) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    throw new SurfaceError("FINALIZATION_ARTIFACT_NOT_REGULAR", path, 68);
  }
}

function pathMetadata(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    throw new SurfaceError(
      "FINALIZATION_ARTIFACT_UNREADABLE",
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
}

function captureTrustedPathBinding(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  const pathFromRoot = relative(absoluteRoot, absolutePath);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new SurfaceError("FINALIZATION_PATH_ESCAPE", absolutePath, 68);
  }
  const parts = pathFromRoot.split(sep);
  const ancestorPaths = [absoluteRoot];
  let current = absoluteRoot;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    ancestorPaths.push(current);
  }
  const ancestors = ancestorPaths.map((ancestorPath) => {
    const metadata = pathMetadata(ancestorPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_INVALID", ancestorPath, 68);
    }
    return { path: ancestorPath, dev: metadata.dev, ino: metadata.ino };
  });
  const finalMetadata = pathMetadata(absolutePath);
  assertRegularSingleLink(finalMetadata, absolutePath);
  let realRoot;
  let realPath;
  try {
    realRoot = realpathSync(absoluteRoot);
    realPath = realpathSync(absolutePath);
  } catch (error) {
    throw new SurfaceError(
      "FINALIZATION_PATH_ESCAPE",
      `${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  const realPathFromRoot = relative(realRoot, realPath);
  if (
    realPathFromRoot === ""
    || realPathFromRoot === ".."
    || realPathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ESCAPE", absolutePath, 68);
  }
  return { root: absoluteRoot, path: absolutePath, realRoot, realPath, ancestors };
}

function assertTrustedPathBinding(binding) {
  const current = captureTrustedPathBinding(binding.root, binding.path);
  if (
    current.realRoot !== binding.realRoot
    || current.realPath !== binding.realPath
    || current.ancestors.length !== binding.ancestors.length
    || current.ancestors.some((ancestor, index) => (
      ancestor.path !== binding.ancestors[index].path
      || ancestor.dev !== binding.ancestors[index].dev
      || ancestor.ino !== binding.ancestors[index].ino
    ))
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", binding.path, 68);
  }
}

function assertAttemptRootDescriptor(binding) {
  let descriptorMetadata;
  try {
    descriptorMetadata = fstatSync(binding.descriptor, { bigint: true });
  } catch (error) {
    throw new SurfaceError(
      "FINALIZATION_PATH_ANCESTOR_CHANGED",
      `${binding.path}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  if (
    binding.closed
    || !descriptorMetadata.isDirectory()
    || descriptorMetadata.dev !== binding.dev
    || descriptorMetadata.ino !== binding.ino
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", binding.path, 68);
  }
  return descriptorMetadata;
}

function assertAttemptRootBinding(binding) {
  assertAttemptRootDescriptor(binding);
  let pathMetadata;
  try {
    pathMetadata = lstatSync(binding.path, { bigint: true });
  } catch (error) {
    throw new SurfaceError(
      "FINALIZATION_PATH_ANCESTOR_CHANGED",
      `${binding.path}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  if (
    !pathMetadata.isDirectory()
    || pathMetadata.isSymbolicLink()
    || pathMetadata.dev !== binding.dev
    || pathMetadata.ino !== binding.ino
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", binding.path, 68);
  }
}

function canonicalProtocolJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalProtocolJson).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${bytewiseSorted(Object.keys(value)).map(
      (key) => `${JSON.stringify(key)}:${canonicalProtocolJson(value[key])}`,
    ).join(",")}}`;
  }
  throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "unsupported value", 68);
}

function assertExactRecord(value, keys, operation) {
  if (
    !isPlainRecord(value)
    || !isDeepStrictEqual(bytewiseSorted(Object.keys(value)), bytewiseSorted(keys))
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
  }
  return value;
}

function assertHeldChildName(name) {
  if (
    typeof name !== "string"
    || name.length === 0
    || name === "."
    || name === ".."
    || Buffer.byteLength(name, "utf8") > 255
    || !/^[A-Za-z0-9._-]+$/u.test(name)
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ESCAPE", String(name), 68);
  }
  return name;
}

function parseDirFdMetadata(value, operation) {
  const record = assertExactRecord(value, ["dev", "ino", "mode", "nlink", "size"], operation);
  const parsed = {};
  for (const key of ["dev", "ino", "mode", "nlink", "size"]) {
    if (typeof record[key] !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(record[key])) {
      throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
    }
    parsed[key] = BigInt(record[key]);
  }
  const type = parsed.mode & BigInt(fsConstants.S_IFMT);
  return {
    ...parsed,
    isDirectory: () => type === BigInt(fsConstants.S_IFDIR),
    isFile: () => type === BigInt(fsConstants.S_IFREG),
    isSymbolicLink: () => type === BigInt(fsConstants.S_IFLNK),
  };
}

const DARWIN_DIR_FD_ERRORS = new Set([
  "EACCES",
  "EBADF",
  "EEXIST",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EMLINK",
  "ENAMETOOLONG",
  "ENOENT",
  "ENOTDIR",
  "ENOTEMPTY",
  "EPERM",
  "EPROTO",
  "EROFS",
  "EXDEV",
  "EUNKNOWN",
]);
let darwinDirFdRuntimeValidated = false;

function invokeDarwinDirFdHelper(binding, request) {
  assertAttemptRootDescriptor(binding);
  assertExactRecord(request, {
    capabilities: ["op"],
    fsync: ["op"],
    link: ["destination", "op", "source"],
    remove_tree: ["expectedDev", "expectedIno", "name", "op"],
    stat: ["name", "op"],
    unlink: ["name", "op"],
    write: ["data", "name", "op"],
  }[request.op] ?? [], request.op ?? "invalid");
  const input = `${canonicalProtocolJson(request)}\n`;
  const child = spawnSync(
    DARWIN_DIR_FD_PYTHON,
    ["-I", "-S", "-c", DARWIN_DIR_FD_HELPER_SOURCE],
    {
      cwd: "/",
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      input,
      maxBuffer: 6 * 1024 * 1024,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", binding.descriptor],
      timeout: 10_000,
    },
  );
  const operation = request.op;
  if (
    child.error
    || child.signal !== null
    || typeof child.stdout !== "string"
    || typeof child.stderr !== "string"
    || child.stderr !== ""
    || ![0, 64, 74].includes(child.status)
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_FAILED", operation, 68);
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
  }
  assertExactRecord(response, ["error", "ok", "op", "result"], operation);
  if (
    child.stdout !== `${canonicalProtocolJson(response)}\n`
    || response.op !== operation
    || typeof response.ok !== "boolean"
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
  }
  if (response.ok) {
    if (child.status !== 0 || response.error !== null || !isPlainRecord(response.result)) {
      throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
    }
    return response.result;
  }
  if (
    ![64, 74].includes(child.status)
    || response.result !== null
    || typeof response.error !== "string"
    || !DARWIN_DIR_FD_ERRORS.has(response.error)
    || (child.status === 64) !== (response.error === "EPROTO")
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
  }
  if (response.error === "EPROTO") {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", operation, 68);
  }
  const error = new Error(`Darwin dir-fd operation failed: ${operation}`);
  error.code = response.error;
  throw error;
}

function validateDarwinDirFdRuntime(binding) {
  if (darwinDirFdRuntimeValidated) return;
  if (!isAbsolute(DARWIN_DIR_FD_PYTHON)) {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_UNAVAILABLE", "python path", 68);
  }
  let executableMetadata;
  let executableRealPath;
  try {
    executableMetadata = statSync(DARWIN_DIR_FD_PYTHON, { bigint: true });
    executableRealPath = realpathSync(DARWIN_DIR_FD_PYTHON);
  } catch {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_UNAVAILABLE", "python executable", 68);
  }
  if (
    !executableMetadata.isFile()
    || (executableMetadata.mode & 0o111n) === 0n
    || !isAbsolute(executableRealPath)
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_UNAVAILABLE", "python executable", 68);
  }
  const result = invokeDarwinDirFdHelper(binding, { op: "capabilities" });
  assertExactRecord(result, ["capabilities", "executable", "root", "version"], "capabilities");
  const root = parseDirFdMetadata(result.root, "capabilities");
  let reportedExecutableMetadata;
  let reportedExecutableRealPath;
  try {
    if (typeof result.executable !== "string" || !isAbsolute(result.executable)) throw new Error();
    reportedExecutableMetadata = statSync(result.executable, { bigint: true });
    reportedExecutableRealPath = realpathSync(result.executable);
  } catch {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_UNAVAILABLE", "reported executable", 68);
  }
  if (
    !isDeepStrictEqual(result.capabilities, DARWIN_DIR_FD_CAPABILITIES)
    || result.executable !== reportedExecutableRealPath
    || !reportedExecutableMetadata.isFile()
    || (reportedExecutableMetadata.mode & 0o111n) === 0n
    || !Array.isArray(result.version)
    || result.version.length !== 3
    || result.version.some((part) => !Number.isSafeInteger(part) || part < 0)
    || result.version[0] < 3
    || (result.version[0] === 3 && result.version[1] < 9)
    || !root.isDirectory()
    || root.dev !== binding.dev
    || root.ino !== binding.ino
  ) {
    throw new SurfaceError("FINALIZATION_DIR_FD_HELPER_UNAVAILABLE", "capabilities", 68);
  }
  darwinDirFdRuntimeValidated = true;
}

function runDarwinDirFdOperation(binding, request) {
  validateDarwinDirFdRuntime(binding);
  return invokeDarwinDirFdHelper(binding, request);
}

function isBoundAttemptRootPath(binding, path, { follow = false } = {}) {
  try {
    const metadata = follow
      ? statSync(path, { bigint: true })
      : lstatSync(path, { bigint: true });
    return (
      metadata.isDirectory()
      && (follow || !metadata.isSymbolicLink())
      && metadata.dev === binding.dev
      && metadata.ino === binding.ino
    );
  } catch {
    return false;
  }
}

function resolveHeldAttemptRootPath(binding) {
  assertAttemptRootDescriptor(binding);
  if (process.platform === "linux") {
    const candidate = `/proc/self/fd/${binding.descriptor}`;
    if (isBoundAttemptRootPath(binding, candidate, { follow: true })) return candidate;
  }
  if (isBoundAttemptRootPath(binding, binding.path)) return binding.path;
  throw new SurfaceError(
    "FINALIZATION_PATH_ANCESTOR_CHANGED",
    `${binding.path}: held root path unavailable`,
    68,
  );
}

function resolveHeldAttemptChild(binding, name) {
  return join(resolveHeldAttemptRootPath(binding), assertHeldChildName(name));
}

function heldAttemptStat(binding, name) {
  assertHeldChildName(name);
  if (process.platform !== "darwin") {
    try {
      return lstatSync(resolveHeldAttemptChild(binding, name), { bigint: true });
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  const result = runDarwinDirFdOperation(binding, { name, op: "stat" });
  assertExactRecord(result, ["exists", "metadata"], "stat");
  if (typeof result.exists !== "boolean") {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "stat", 68);
  }
  if (!result.exists) {
    if (result.metadata !== null) {
      throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "stat", 68);
    }
    return undefined;
  }
  return parseDirFdMetadata(result.metadata, "stat");
}

function heldAttemptEntryExists(binding, name) {
  return heldAttemptStat(binding, name) !== undefined;
}

function heldAttemptWriteExclusive(binding, name, bytes) {
  assertHeldChildName(name);
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (process.platform === "darwin") {
    const result = runDarwinDirFdOperation(binding, {
      data: data.toString("base64"),
      name,
      op: "write",
    });
    assertExactRecord(result, ["metadata"], "write");
    return parseDirFdMetadata(result.metadata, "write");
  }
  let descriptor;
  let metadata;
  let operationError;
  try {
    descriptor = openSync(resolveHeldAttemptChild(binding, name), "wx", 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    metadata = fstatSync(descriptor, { bigint: true });
  } catch (error) {
    operationError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (error) {
        if (operationError instanceof Error && !Reflect.has(operationError, "cause")) {
          operationError.cause = error;
        } else if (!operationError) {
          operationError = error;
        }
      }
    }
  }
  if (operationError) throw operationError;
  return metadata;
}

function createRunnerOutputCollision(path, cause) {
  const failure = new SurfaceError("RUNNER_OUTPUT_COLLISION", path, 64);
  failure.cause = cause;
  return failure;
}

function mapRunnerOutputCollision(path, error) {
  if (error instanceof Error && error.code === "EEXIST") {
    throw createRunnerOutputCollision(path, error);
  }
  throw error;
}

function writeExclusiveArtifactPath(path, bytes) {
  const parentBinding = openAttemptRootBinding(dirname(resolve(path)));
  let metadata;
  let operationError;
  try {
    try {
      metadata = heldAttemptWriteExclusive(parentBinding, basename(path), bytes);
    } catch (error) {
      mapRunnerOutputCollision(path, error);
    }
  } catch (error) {
    operationError = error;
  } finally {
    try {
      closeAttemptRootBinding(parentBinding);
    } catch (error) {
      if (operationError instanceof Error && !Reflect.has(operationError, "cause")) {
        operationError.cause = error;
      } else {
        operationError ??= error;
      }
    }
  }
  if (operationError) throw operationError;
  return metadata;
}

function writeRunnerArtifactExclusive({ rootBinding, attemptDir, path, bytes }) {
  assertAttemptRootBinding(rootBinding);
  const absolutePath = resolveAttemptPath(attemptDir, path);
  const parentPath = dirname(absolutePath);
  let parentBinding;
  let ownsParentBinding = false;
  try {
    if (parentPath === resolve(attemptDir)) {
      parentBinding = rootBinding;
    } else {
      const trustedParent = captureTrustedPathBinding(attemptDir, parentPath);
      parentBinding = openAttemptRootBinding(parentPath);
      ownsParentBinding = true;
      const expectedParent = trustedParent.ancestors.at(-1);
      if (
        expectedParent === undefined
        || expectedParent.dev !== parentBinding.dev
        || expectedParent.ino !== parentBinding.ino
      ) {
        throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", parentPath, 68);
      }
    }
    assertAttemptRootBinding(rootBinding);
    try {
      return heldAttemptWriteExclusive(parentBinding, basename(absolutePath), bytes);
    } catch (error) {
      mapRunnerOutputCollision(path, error);
    }
  } finally {
    if (ownsParentBinding) closeAttemptRootBinding(parentBinding);
  }
}

function sameInodeIdentity(left, right) {
  return left !== undefined && right !== undefined && left.dev === right.dev && left.ino === right.ino;
}

function createJsonJournalFromBinding(binding, name, initialValue, closeBinding) {
  const initialBytes = Buffer.from(`${JSON.stringify(initialValue, null, 2)}\n`);
  let expectedMetadata;
  try {
    expectedMetadata = heldAttemptWriteExclusive(binding, name, initialBytes);
  } catch (error) {
    mapRunnerOutputCollision(name, error);
  }
  let descriptor;
  try {
    descriptor = openSync(
      resolveHeldAttemptChild(binding, name),
      fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
    );
    const descriptorMetadata = fstatSync(descriptor, { bigint: true });
    const pathMetadata = heldAttemptStat(binding, name);
    if (
      !descriptorMetadata.isFile()
      || !sameInodeIdentity(descriptorMetadata, expectedMetadata)
      || !sameInodeIdentity(descriptorMetadata, pathMetadata)
    ) {
      throw createRunnerOutputCollision(name, new Error("journal identity changed during reservation"));
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (closeBinding) closeAttemptRootBinding(binding);
    throw error;
  }
  let closed = false;
  return {
    identity: Object.freeze({
      dev: expectedMetadata.dev.toString(),
      ino: expectedMetadata.ino.toString(),
    }),
    metadata: expectedMetadata,
    write(value) {
      if (closed) throw new SurfaceError("RUNNER_JOURNAL_CLOSED", name, 68);
      const beforeDescriptor = fstatSync(descriptor, { bigint: true });
      const beforePath = heldAttemptStat(binding, name);
      if (!sameInodeIdentity(beforeDescriptor, expectedMetadata) || !sameInodeIdentity(beforeDescriptor, beforePath)) {
        throw createRunnerOutputCollision(name, new Error("journal path replaced"));
      }
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      ftruncateSync(descriptor, 0);
      writeSync(descriptor, bytes, 0, bytes.length, 0);
      fsyncSync(descriptor);
      const afterDescriptor = fstatSync(descriptor, { bigint: true });
      const afterPath = heldAttemptStat(binding, name);
      if (!sameInodeIdentity(afterDescriptor, expectedMetadata) || !sameInodeIdentity(afterDescriptor, afterPath)) {
        throw createRunnerOutputCollision(name, new Error("journal path replaced during update"));
      }
    },
    close() {
      if (closed) return;
      closed = true;
      let failure;
      try {
        closeSync(descriptor);
      } catch (error) {
        failure = error;
      }
      if (closeBinding) {
        try {
          closeAttemptRootBinding(binding);
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure) throw failure;
    },
  };
}

export function createOwnedJsonJournal(directoryPath, name, initialValue) {
  const binding = openAttemptRootBinding(directoryPath);
  return createJsonJournalFromBinding(binding, name, initialValue, true);
}

function heldAttemptLink(binding, source, destination) {
  assertHeldChildName(source);
  assertHeldChildName(destination);
  if (process.platform !== "darwin") {
    linkSync(resolveHeldAttemptChild(binding, source), resolveHeldAttemptChild(binding, destination));
    return;
  }
  const result = runDarwinDirFdOperation(binding, { destination, op: "link", source });
  assertExactRecord(result, ["linked"], "link");
  if (result.linked !== true) {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "link", 68);
  }
}

function heldAttemptUnlink(binding, name) {
  assertHeldChildName(name);
  if (process.platform !== "darwin") {
    try {
      unlinkSync(resolveHeldAttemptChild(binding, name));
      return true;
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") return false;
      throw error;
    }
  }
  const result = runDarwinDirFdOperation(binding, { name, op: "unlink" });
  assertExactRecord(result, ["removed"], "unlink");
  if (typeof result.removed !== "boolean") {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "unlink", 68);
  }
  return result.removed;
}

function fsyncHeldAttemptRoot(binding) {
  if (process.platform !== "darwin") {
    assertAttemptRootDescriptor(binding);
    fsyncSync(binding.descriptor);
    return;
  }
  const result = runDarwinDirFdOperation(binding, { op: "fsync" });
  assertExactRecord(result, ["synced"], "fsync");
  if (result.synced !== true) {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "fsync", 68);
  }
}

function heldAttemptRemoveOwnedTree(binding, name, expectedMetadata) {
  assertHeldChildName(name);
  if (!expectedMetadata?.isDirectory() || expectedMetadata.isSymbolicLink()) {
    return { identityMatched: false, removed: false };
  }
  const result = runDarwinDirFdOperation(binding, {
    expectedDev: expectedMetadata.dev.toString(),
    expectedIno: expectedMetadata.ino.toString(),
    name,
    op: "remove_tree",
  });
  assertExactRecord(result, ["identityMatched", "removed"], "remove_tree");
  if (typeof result.identityMatched !== "boolean" || typeof result.removed !== "boolean") {
    throw new SurfaceError("FINALIZATION_DIR_FD_PROTOCOL_INVALID", "remove_tree", 68);
  }
  return result;
}

function heldAttemptRemoveTree(binding, name) {
  const expectedMetadata = heldAttemptStat(binding, name);
  if (!expectedMetadata) return false;
  const result = heldAttemptRemoveOwnedTree(binding, name, expectedMetadata);
  return result.identityMatched && result.removed;
}

function captureRunnerAttemptCleanupBaseline(binding, evidenceDir) {
  assertAttemptRootBinding(binding);
  const names = bytewiseSorted(new Set([
    ...FINALIZATION_ARTIFACT_PATHS
      .map((path) => path.split("/")[0])
      .filter((name) => name !== "real-surface"),
    basename(evidenceDir),
    "finalization-manifest.json",
  ]));
  return {
    names,
    preexisting: new Set(names.filter((name) => heldAttemptEntryExists(binding, name))),
  };
}

function cleanupRunnerAttemptArtifacts(binding, baseline) {
  let failure;
  let directoryChanged = false;
  for (const name of [...baseline.names].reverse()) {
    if (baseline.preexisting.has(name)) continue;
    try {
      directoryChanged = heldAttemptRemoveTree(binding, name) || directoryChanged;
    } catch (error) {
      failure ??= error;
    }
  }
  if (directoryChanged) {
    try {
      fsyncHeldAttemptRoot(binding);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

function openAttemptRootBinding(attemptDir) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW) || !Number.isInteger(fsConstants.O_DIRECTORY)) {
    throw new SurfaceError("FINALIZATION_NOFOLLOW_UNAVAILABLE", "O_NOFOLLOW/O_DIRECTORY", 68);
  }
  const path = resolve(attemptDir);
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!metadata.isDirectory()) {
      throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_INVALID", path, 68);
    }
    const binding = { path, descriptor, dev: metadata.dev, ino: metadata.ino, closed: false };
    assertAttemptRootBinding(binding);
    descriptor = undefined;
    return binding;
  } catch (error) {
    if (error instanceof SurfaceError) throw error;
    throw new SurfaceError(
      "FINALIZATION_PATH_ANCESTOR_INVALID",
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function closeAttemptRootBinding(binding) {
  if (binding.closed) return;
  let failure;
  try {
    assertAttemptRootBinding(binding);
  } catch (error) {
    failure = error;
  }
  try {
    closeSync(binding.descriptor);
  } catch (error) {
    failure ??= new SurfaceError(
      "FINALIZER_CLOCK_PROBE_FAILED",
      `${binding.path}: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  binding.closed = true;
  if (failure) throw failure;
}

function createStableDescriptorSet(expectedRootBindings = []) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new SurfaceError("FINALIZATION_NOFOLLOW_UNAVAILABLE", "O_NOFOLLOW", 68);
  }
  const handles = new Map();
  const expectedRoots = new Map(expectedRootBindings.map((binding) => [binding.path, binding]));

  const assertExpectedRoot = (root) => {
    const expected = expectedRoots.get(resolve(root));
    if (expected) assertAttemptRootBinding(expected);
    return expected;
  };

  const assertBindingUsesExpectedRoot = (binding) => {
    const expected = expectedRoots.get(binding.root);
    if (!expected) return;
    const rootAncestor = binding.ancestors[0];
    if (
      !rootAncestor
      || rootAncestor.path !== expected.path
      || rootAncestor.dev !== expected.dev
      || rootAncestor.ino !== expected.ino
    ) {
      throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", binding.path, 68);
    }
  };

  const assertStable = (handle) => {
    assertExpectedRoot(handle.binding.root);
    assertBindingUsesExpectedRoot(handle.binding);
    assertTrustedPathBinding(handle.binding);
    let descriptorMetadata;
    try {
      descriptorMetadata = fstatSync(handle.descriptor, { bigint: true });
    } catch (error) {
      throw new SurfaceError(
        "FINALIZATION_ARTIFACT_CHANGED",
        `${handle.path}: ${error instanceof Error ? error.message : String(error)}`,
        68,
      );
    }
    assertRegularSingleLink(descriptorMetadata, handle.path);
    const currentPathMetadata = pathMetadata(handle.path);
    assertRegularSingleLink(currentPathMetadata, handle.path);
    if (
      !sameArtifactIdentity(handle.metadata, descriptorMetadata)
      || !sameArtifactIdentity(handle.metadata, currentPathMetadata)
    ) {
      throw new SurfaceError("FINALIZATION_ARTIFACT_CHANGED", handle.path, 68);
    }
    assertExpectedRoot(handle.binding.root);
  };

  return {
    open(trustedRoot, path, { allowEmpty = false } = {}) {
      const absoluteRoot = resolve(trustedRoot);
      const absolutePath = resolve(path);
      assertExpectedRoot(absoluteRoot);
      const existing = handles.get(absolutePath);
      if (existing) {
        if (existing.binding.root !== absoluteRoot) {
          throw new SurfaceError("FINALIZATION_PATH_ESCAPE", absolutePath, 68);
        }
        assertStable(existing);
        if (!allowEmpty && existing.bytes.length === 0) {
          throw new SurfaceError("FINALIZATION_ARTIFACT_EMPTY", absolutePath, 68);
        }
        return existing;
      }
      const binding = captureTrustedPathBinding(absoluteRoot, absolutePath);
      assertBindingUsesExpectedRoot(binding);
      assertExpectedRoot(absoluteRoot);
      let descriptor;
      try {
        descriptor = openSync(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const metadata = fstatSync(descriptor, { bigint: true });
        assertRegularSingleLink(metadata, absolutePath);
        if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new SurfaceError("FINALIZATION_ARTIFACT_TOO_LARGE", absolutePath, 68);
        }
        const bytes = readFileSync(descriptor);
        if (BigInt(bytes.length) !== metadata.size) {
          throw new SurfaceError("FINALIZATION_ARTIFACT_CHANGED", absolutePath, 68);
        }
        if (!allowEmpty && bytes.length === 0) {
          throw new SurfaceError("FINALIZATION_ARTIFACT_EMPTY", absolutePath, 68);
        }
        const handle = {
          path: absolutePath,
          descriptor,
          bytes,
          sha256: sha256(bytes),
          metadata,
          binding,
        };
        assertStable(handle);
        handles.set(absolutePath, handle);
        descriptor = undefined;
        return handle;
      } catch (error) {
        if (error instanceof SurfaceError) throw error;
        const code = error instanceof Error && Reflect.has(error, "code") ? error.code : undefined;
        if (code === "ELOOP") {
          throw new SurfaceError("FINALIZATION_ARTIFACT_NOT_REGULAR", absolutePath, 68);
        }
        throw new SurfaceError(
          "FINALIZATION_ARTIFACT_UNREADABLE",
          `${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
          68,
        );
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    },
    assertStable,
    assertAllStable() {
      for (const expected of expectedRoots.values()) assertAttemptRootBinding(expected);
      for (const handle of handles.values()) assertStable(handle);
      for (const expected of expectedRoots.values()) assertAttemptRootBinding(expected);
    },
    values() {
      return [...handles.values()];
    },
    closeAll() {
      let failure;
      for (const handle of handles.values()) {
        try {
          closeSync(handle.descriptor);
        } catch (error) {
          failure ??= error;
        }
      }
      handles.clear();
      if (failure) throw failure;
    },
  };
}

function sourceAggregateFromDescriptors(root, paths, descriptors) {
  if (new Set(paths).size !== paths.length) {
    throw new SurfaceError("SOURCE_MANIFEST_DUPLICATE_PATH", "owned path list contains duplicates", 68);
  }
  const entries = bytewiseSorted(paths).map((path) => {
    const handle = descriptors.open(root, resolveAttemptPath(root, path));
    return { path, sha256: handle.sha256, bytes: handle.bytes.length };
  });
  const framing = Buffer.concat(entries.map((entry) => Buffer.from(
    `${entry.path}\0${entry.sha256}\0${entry.bytes}\n`,
    "utf8",
  )));
  return {
    count: entries.length,
    entries,
    sha256: sha256(framing),
    bytes: framing.byteLength,
  };
}

function regularArtifact(path, { allowEmpty = false } = {}) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ENOENT") {
      throw new SurfaceError("FINALIZATION_ARTIFACT_MISSING", path, 68);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new SurfaceError("FINALIZATION_ARTIFACT_NOT_REGULAR", path, 68);
  }
  if (!allowEmpty && metadata.size === 0) {
    throw new SurfaceError("FINALIZATION_ARTIFACT_EMPTY", path, 68);
  }
  const bytes = readFileSync(path);
  return { bytes: metadata.size, sha256: sha256(bytes), metadata };
}

export function buildOwnedSourceManifest(root, paths) {
  const descriptors = createStableDescriptorSet();
  try {
    const aggregate = sourceAggregateFromDescriptors(root, paths, descriptors);
    descriptors.assertAllStable();
    return {
      schemaVersion: 1,
      count: aggregate.count,
      entries: aggregate.entries,
      framingBytes: aggregate.bytes,
      aggregateSha256: aggregate.sha256,
    };
  } finally {
    descriptors.closeAll();
  }
}

export function parseVitestCount(source) {
  // Strip ANSI SGR color sequences only (ESC [ ... m). Vitest 4 under a TTY-capable
  // environment may color the summary line as `Tests\x1b[22m \x1b[1m\x1b[32m45 passed`.
  // Do not build a generic terminal-sequence parser; SGR is the observed class.
  const colorless = source.replace(/\u001b\[[0-9;]*m/g, "");
  const matches = [...colorless.matchAll(/\bTests\s+(\d+)\s+passed\b/gu)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((match) => Number(match[1])));
}

export function validateFocusedArtifact({ path, startedAt, endedAt, expectedSha256 }) {
  let artifact;
  try {
    artifact = regularArtifact(path);
  } catch (error) {
    if (error instanceof SurfaceError && error.code === "FINALIZATION_ARTIFACT_EMPTY") {
      throw new SurfaceError("FOCUSED_ARTIFACT_EMPTY", path, 68);
    }
    if (error instanceof SurfaceError && error.code === "FINALIZATION_ARTIFACT_NOT_REGULAR") {
      throw new SurfaceError("FOCUSED_ARTIFACT_NOT_REGULAR", path, 68);
    }
    throw error;
  }
  const mtime = artifact.metadata.mtimeMs;
  if (mtime < startedAt || Math.floor(mtime) > endedAt) {
    throw new SurfaceError(
      "FOCUSED_ARTIFACT_STALE",
      `${path} mtime=${mtime} window=${startedAt}-${endedAt}`,
      68,
    );
  }
  if (expectedSha256 !== undefined && artifact.sha256 !== expectedSha256) {
    throw new SurfaceError("FOCUSED_ARTIFACT_HASH_MISMATCH", path, 68);
  }
  const testCount = parseVitestCount(artifact.bytes === 0 ? "" : readFileSync(path, "utf8"));
  if (testCount <= 0) throw new SurfaceError("FOCUSED_ARTIFACT_ZERO_TESTS", path, 68);
  return {
    path,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    mtime,
    startedAt,
    endedAt,
    testCount,
  };
}

export function createWorkflowPreflightMatrix({
  node22Bin,
  workflowRoot,
  runtimeDir,
  commonEnv,
  workflowOperatorPort,
}) {
  const entrypoints = [
    {
      entrypoint: "workflow-operator",
      argv: [
        join(workflowRoot, "node_modules/tsx/dist/cli.mjs"),
        join(workflowRoot, "apps/operator-console/src/server.ts"),
      ],
      env: { ...commonEnv, PORT: String(workflowOperatorPort) },
      port: workflowOperatorPort,
    },
    {
      entrypoint: "workflow-mcp",
      argv: [
        join(workflowRoot, "node_modules/tsx/dist/cli.mjs"),
        join(workflowRoot, "apps/mcp-server/src/index.ts"),
      ],
      env: { ...commonEnv },
      port: undefined,
    },
  ];
  const fields = [
    "MCP_API_KEY",
    "SANGFOR_API_KEY",
    "SANGFOR_OPERATOR_PRINCIPAL_ID",
    "WHELP99_ENFORCE_SAFE_TOOLS",
  ];
  const variants = ["missing", "blank"];
  return entrypoints.flatMap((entrypoint) => fields.flatMap((field) => variants.map((variant) => {
    const env = { ...entrypoint.env, TSX_TSCONFIG_PATH: join(workflowRoot, "tsconfig.json") };
    if (variant === "missing") delete env[field];
    else env[field] = "   ";
    return {
      id: `${entrypoint.entrypoint}:${field}:${variant}`,
      entrypoint: entrypoint.entrypoint,
      field,
      variant,
      node: node22Bin,
      argv: entrypoint.argv,
      cwd: join(runtimeDir, `preflight-${entrypoint.entrypoint}-${field.toLowerCase()}-${variant}`),
      env,
      port: entrypoint.port,
      expectedExitCode: 78,
    };
  })));
}

function ipcMessageKeys(type) {
  if (type === "armed") return ["boundary", "nonce", "protocol", "type"];
  if (type === "capture") return ["arguments", "boundary", "nonce", "protocol", "toolName", "type"];
  if (type === "complete") return ["boundary", "nonce", "outcome", "protocol", "type"];
  return [];
}

export function createIpcObservation({
  boundary,
  nonce,
  deadlineAt,
  expectedToolName,
  expectedArguments,
}) {
  if (!(["api-to-infra", "bridge-to-child"].includes(boundary)) || nonce.length === 0) {
    throw new SurfaceError("IPC_OBSERVATION_INVALID", `${boundary}:${nonce}`, 68);
  }
  return {
    boundary,
    nonce,
    deadlineAt,
    expectedToolName,
    expectedArguments,
    state: "idle",
    capture: undefined,
    error: undefined,
    release() {
      if (this.state !== "captured") {
        this.error = "IPC_RELEASE_OUT_OF_ORDER";
        throw new SurfaceError(this.error, this.boundary, 68);
      }
      this.state = "released";
    },
  };
}

export function acceptIpcObservation(observation, message, receivedAt) {
  if (!isPlainRecord(message)) return { kind: "ignored" };
  if (
    message.protocol !== IPC_PROTOCOL
    || message.boundary !== observation.boundary
    || message.nonce !== observation.nonce
  ) return { kind: "ignored" };
  if (typeof message.type !== "string") return { kind: "ignored" };
  const expectedKeys = ipcMessageKeys(message.type);
  const actualKeys = Object.keys(message).sort((left, right) => left.localeCompare(right, "en"));
  if (expectedKeys.length === 0 || !isDeepStrictEqual(actualKeys, expectedKeys)) return { kind: "ignored" };
  if (receivedAt > observation.deadlineAt) {
    observation.error = "IPC_CAPTURE_DEADLINE_EXCEEDED";
    throw new SurfaceError(observation.error, observation.boundary, 68);
  }
  if (message.type === "armed") {
    if (observation.state !== "idle") {
      observation.error = "IPC_ARM_DUPLICATE";
      throw new SurfaceError(observation.error, observation.boundary, 68);
    }
    observation.state = "armed";
    return { kind: "armed" };
  }
  if (message.type === "capture") {
    if (observation.state === "captured" || observation.state === "released" || observation.state === "complete") {
      observation.error = "IPC_CAPTURE_DUPLICATE";
      throw new SurfaceError(observation.error, observation.boundary, 68);
    }
    if (
      observation.state !== "armed"
      || message.toolName !== observation.expectedToolName
      || !isPlainRecord(message.arguments)
      || !isDeepStrictEqual(message.arguments, observation.expectedArguments)
    ) {
      observation.error = "IPC_CAPTURE_MISMATCH";
      throw new SurfaceError(observation.error, observation.boundary, 68);
    }
    observation.capture = { toolName: message.toolName, arguments: message.arguments };
    observation.state = "captured";
    return { kind: "capture", capture: observation.capture };
  }
  if (observation.state !== "released" || !(["returned", "threw"].includes(message.outcome))) {
    observation.error = "IPC_COMPLETE_OUT_OF_ORDER";
    throw new SurfaceError(observation.error, observation.boundary, 68);
  }
  observation.state = "complete";
  observation.outcome = message.outcome;
  return { kind: "complete", outcome: message.outcome };
}

export function finalizeIpcObservation(observation) {
  if (observation.error || observation.state !== "complete" || observation.outcome !== "returned" || !observation.capture) {
    throw new SurfaceError(
      "IPC_EVIDENCE_INCOMPLETE",
      `${observation.boundary}:${observation.error ?? observation.state}`,
      68,
    );
  }
  return observation.capture;
}

const OBSERVED_COUNTER_NAMES = [
  "toolEnumeration",
  "handlerCall",
  "infra",
  "bridge",
  "child",
  "external",
  "restore",
];

export function createObservedCounterJournal(runId) {
  return {
    runId,
    events: Object.fromEntries(OBSERVED_COUNTER_NAMES.map((name) => [name, []])),
    channels: {},
  };
}

export function recordObservedEvent(journal, counter, event) {
  if (!OBSERVED_COUNTER_NAMES.includes(counter) || typeof event !== "string" || event.length === 0) {
    throw new SurfaceError("OBSERVED_COUNTER_EVENT_INVALID", `${counter}:${event}`, 68);
  }
  if (journal.events[counter].includes(event)) {
    throw new SurfaceError("OBSERVED_COUNTER_EVENT_DUPLICATE", `${counter}:${event}`, 68);
  }
  journal.events[counter].push(event);
}

export function markObservedChannel(journal, counter, channel, probeCount) {
  if (!OBSERVED_COUNTER_NAMES.includes(counter) || typeof channel !== "string" || !Number.isInteger(probeCount) || probeCount <= 0) {
    throw new SurfaceError("OBSERVED_COUNTER_CHANNEL_INVALID", `${counter}:${channel}:${probeCount}`, 68);
  }
  journal.channels[counter] = { channel, probeCount };
}

export function finalizeObservedCounters(journal) {
  const positive = ["toolEnumeration", "handlerCall", "infra", "bridge", "child"];
  const zeroAllowed = ["external", "restore"];
  const missing = [
    ...positive.filter((name) => journal.events[name].length === 0),
    ...zeroAllowed.filter((name) => journal.channels[name] === undefined),
  ];
  if (missing.length > 0) {
    throw new SurfaceError("OBSERVED_COUNTER_EVIDENCE_MISSING", missing.join(","), 68);
  }
  const counters = Object.fromEntries(OBSERVED_COUNTER_NAMES.map((name) => [name, {
    count: journal.events[name].length,
    events: [...journal.events[name]],
    ...(journal.channels[name] ?? {}),
  }]));
  return { schemaVersion: 1, runId: journal.runId, counters };
}

function initialWebEnvReadAudit() {
  return {
    schemaVersion: 1,
    guardExecutions: { build: 0, start: 0, unknown: 0 },
    blockedAttempts: [],
    delegatedReadCount: 0,
  };
}

export function writeWebEnvReadGuard({ guardPath, auditPath, repository, home, auditJournal }) {
  for (const path of [guardPath, auditPath, repository, home]) {
    if (!isAbsolute(path)) throw new SurfaceError("WEB_ENV_GUARD_PATH_INVALID", path, 68);
  }
  if (existsSync(guardPath)) {
    throw new SurfaceError("WEB_ENV_GUARD_NOT_FRESH", guardPath, 68);
  }
  const ownsAuditJournal = auditJournal === undefined;
  const journal = auditJournal ?? createOwnedJsonJournal(
    dirname(auditPath),
    basename(auditPath),
    initialWebEnvReadAudit(),
  );
  if (
    !isPlainRecord(journal.identity)
    || !/^(?:0|[1-9][0-9]*)$/u.test(journal.identity.dev ?? "")
    || !/^(?:0|[1-9][0-9]*)$/u.test(journal.identity.ino ?? "")
  ) {
    if (ownsAuditJournal) journal.close();
    throw new SurfaceError("WEB_ENV_AUDIT_IDENTITY_INVALID", auditPath, 68);
  }
  const auditMetadata = pathMetadata(auditPath);
  assertRegularSingleLink(auditMetadata, auditPath);
  if (
    auditMetadata.dev.toString() !== journal.identity.dev
    || auditMetadata.ino.toString() !== journal.identity.ino
  ) {
    if (ownsAuditJournal) journal.close();
    throw createRunnerOutputCollision(auditPath, new Error("web env audit identity changed before guard creation"));
  }
  const configuration = JSON.stringify({
    auditPath,
    repository,
    home,
    auditIdentity: journal.identity,
  });
  const source = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { fileURLToPath } = require('node:url');",
    `const configuration = ${configuration};`,
    "const lockPath = configuration.auditPath + '.lock';",
    "const phase = process.argv.includes('build') ? 'build' : process.argv.includes('start') ? 'start' : 'unknown';",
    "const originals = {",
    "  open: fs.open, openSync: fs.openSync, read: fs.read, readSync: fs.readSync,",
    "  readFile: fs.readFile, readFileSync: fs.readFileSync, createReadStream: fs.createReadStream,",
    "  promisesOpen: fs.promises.open.bind(fs.promises), promisesReadFile: fs.promises.readFile.bind(fs.promises),",
    "  existsSync: fs.existsSync, unlinkSync: fs.unlinkSync, closeSync: fs.closeSync,",
    "  fstatSync: fs.fstatSync, fsyncSync: fs.fsyncSync, ftruncateSync: fs.ftruncateSync,",
    "  lstatSync: fs.lstatSync, writeSync: fs.writeSync, writeFileSync: fs.writeFileSync, readlinkSync: fs.readlinkSync,",
    "};",
    "function acquireLock() {",
    "  for (let attempt = 0; attempt < 200; attempt += 1) {",
    "    try { return originals.openSync(lockPath, 'wx', 0o600); } catch (error) {",
    "      if (!error || error.code !== 'EEXIST') throw error;",
    "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
    "    }",
    "  }",
    "  throw new Error('U002_ENV_AUDIT_LOCK_TIMEOUT');",
    "}",
    "function identityFailure() {",
    "  const error = new Error('U002_ENV_AUDIT_IDENTITY_CHANGED');",
    "  error.code = 'U002_ENV_AUDIT_IDENTITY_CHANGED';",
    "  return error;",
    "}",
    "function assertAuditIdentity(descriptor) {",
    "  let descriptorMetadata;",
    "  let pathMetadata;",
    "  try {",
    "    descriptorMetadata = originals.fstatSync(descriptor, { bigint: true });",
    "    pathMetadata = originals.lstatSync(configuration.auditPath, { bigint: true });",
    "  } catch { throw identityFailure(); }",
    "  const expected = configuration.auditIdentity;",
    "  if (",
    "    !descriptorMetadata.isFile() || !pathMetadata.isFile() || pathMetadata.isSymbolicLink()",
    "    || descriptorMetadata.nlink !== 1n || pathMetadata.nlink !== 1n",
    "    || descriptorMetadata.dev.toString() !== expected.dev || descriptorMetadata.ino.toString() !== expected.ino",
    "    || pathMetadata.dev.toString() !== expected.dev || pathMetadata.ino.toString() !== expected.ino",
    "  ) throw identityFailure();",
    "}",
    "function updateAudit(mutator) {",
    "  const lock = acquireLock();",
    "  let descriptor;",
    "  try {",
    "    try { descriptor = originals.openSync(configuration.auditPath, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW); }",
    "    catch { throw identityFailure(); }",
    "    assertAuditIdentity(descriptor);",
    "    const audit = JSON.parse(originals.readFileSync(descriptor, 'utf8'));",
    "    mutator(audit);",
    "    const bytes = Buffer.from(JSON.stringify(audit, null, 2) + '\\n');",
    "    originals.ftruncateSync(descriptor, 0);",
    "    originals.writeSync(descriptor, bytes, 0, bytes.length, 0);",
    "    originals.fsyncSync(descriptor);",
    "    assertAuditIdentity(descriptor);",
    "  } finally {",
    "    if (descriptor !== undefined) originals.closeSync(descriptor);",
    "    originals.closeSync(lock);",
    "    try { originals.unlinkSync(lockPath); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }",
    "  }",
    "}",
    "function normalizePath(value) {",
    "  if (value instanceof URL) return path.resolve(fileURLToPath(value));",
    "  if (Buffer.isBuffer(value)) return path.resolve(value.toString());",
    "  return typeof value === 'string' ? path.resolve(value) : undefined;",
    "}",
    "function descriptorPath(value) {",
    "  if (!Number.isInteger(value)) return undefined;",
    "  try { return path.resolve(originals.readlinkSync('/dev/fd/' + value)); } catch { return undefined; }",
    "}",
    "function isDotenv(target) {",
    "  if (!target) return false;",
    "  const name = path.basename(target);",
    "  return name === '.env' || name.startsWith('.env.');",
    "}",
    "function block(target, method) {",
    "  const normalized = normalizePath(target) || descriptorPath(target);",
    "  if (!isDotenv(normalized)) return;",
    "  updateAudit((audit) => { audit.blockedAttempts.push({ phase, method, path: normalized }); });",
    "  const error = new Error('U002_ENV_READ_BLOCKED'); error.code = 'U002_ENV_READ_BLOCKED'; throw error;",
    "}",
    "updateAudit((audit) => { audit.guardExecutions[phase] = (audit.guardExecutions[phase] || 0) + 1; });",
    "fs.open = function guardedOpen(target, ...args) { block(target, 'open'); return originals.open.call(fs, target, ...args); };",
    "fs.openSync = function guardedOpenSync(target, ...args) { block(target, 'openSync'); return originals.openSync.call(fs, target, ...args); };",
    "fs.read = function guardedRead(descriptor, ...args) { block(descriptor, 'read'); return originals.read.call(fs, descriptor, ...args); };",
    "fs.readSync = function guardedReadSync(descriptor, ...args) { block(descriptor, 'readSync'); return originals.readSync.call(fs, descriptor, ...args); };",
    "fs.readFile = function guardedReadFile(target, ...args) { block(target, 'readFile'); return originals.readFile.call(fs, target, ...args); };",
    "fs.readFileSync = function guardedReadFileSync(target, ...args) { block(target, 'readFileSync'); return originals.readFileSync.call(fs, target, ...args); };",
    "fs.createReadStream = function guardedCreateReadStream(target, ...args) { block(target, 'createReadStream'); return originals.createReadStream.call(fs, target, ...args); };",
    "fs.promises.open = async function guardedPromisesOpen(target, ...args) { block(target, 'promises.open'); return originals.promisesOpen(target, ...args); };",
    "fs.promises.readFile = async function guardedPromisesReadFile(target, ...args) { block(target, 'promises.readFile'); return originals.promisesReadFile(target, ...args); };",
    "",
  ].join("\n");
  try {
    writeFileSync(guardPath, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (ownsAuditJournal) journal.close();
    mapRunnerOutputCollision(guardPath, error);
  }
  const guard = regularArtifact(guardPath);
  return { path: guardPath, sha256: guard.sha256, bytes: guard.bytes, auditJournal: journal };
}

export function validateWebEnvReadAudit(auditPath) {
  const artifact = regularArtifact(auditPath);
  let audit;
  try {
    audit = JSON.parse(readFileSync(auditPath, "utf8"));
  } catch (error) {
    throw new SurfaceError(
      "WEB_ENV_AUDIT_INVALID",
      error instanceof Error ? error.message : String(error),
      68,
    );
  }
  if (
    !isPlainRecord(audit)
    || audit.schemaVersion !== 1
    || !isPlainRecord(audit.guardExecutions)
    || !Number.isInteger(audit.guardExecutions.build)
    || audit.guardExecutions.build < 1
    || !Number.isInteger(audit.guardExecutions.start)
    || audit.guardExecutions.start < 1
    || audit.delegatedReadCount !== 0
    || !Array.isArray(audit.blockedAttempts)
    || audit.blockedAttempts.some((attempt) => (
      !isPlainRecord(attempt)
      || typeof attempt.phase !== "string"
      || typeof attempt.method !== "string"
      || typeof attempt.path !== "string"
      || Object.hasOwn(attempt, "content")
    ))
  ) {
    throw new SurfaceError("WEB_ENV_AUDIT_INVALID", auditPath, 68);
  }
  return { ...audit, sha256: artifact.sha256, bytes: artifact.bytes };
}

function assertExactKeys(value, keys, label, code = "FINALIZATION_MANIFEST_INVALID") {
  if (!isPlainRecord(value) || !isDeepStrictEqual(Object.keys(value), keys)) {
    throw new SurfaceError(code, `${label}: closed schema mismatch`, 68);
  }
}

function assertRelativeRecordPath(path, label, code = "FINALIZATION_MANIFEST_INVALID") {
  if (
    typeof path !== "string"
    || path.length === 0
    || isAbsolute(path)
    || path.includes("\\")
    || path.includes("\0")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new SurfaceError(code, `${label}: invalid path`, 68);
  }
}

function assertArtifactRecord(value, label, { allowEmpty = false } = {}) {
  assertExactKeys(value, ["path", "sha256", "bytes"], label);
  assertRelativeRecordPath(value.path, label);
  if (
    !/^[a-f0-9]{64}$/u.test(value.sha256)
    || !Number.isInteger(value.bytes)
    || value.bytes < (allowEmpty ? 0 : 1)
  ) {
    throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", `${label}: invalid hash or byte length`, 68);
  }
}

function validateSourceAggregate(value, label, code = "FINALIZATION_SOURCE_INTEGRITY_INVALID") {
  assertExactKeys(value, ["count", "entries", "sha256", "bytes"], label, code);
  if (value.count !== 96 || !Array.isArray(value.entries) || value.entries.length !== 96) {
    throw new SurfaceError(code, `${label}: count`, 68);
  }
  const expectedPaths = bytewiseSorted(OWNED_PATHS);
  const actualPaths = [];
  for (const [index, entry] of value.entries.entries()) {
    assertExactKeys(entry, ["path", "sha256", "bytes"], `${label}.entries[${index}]`, code);
    assertRelativeRecordPath(entry.path, `${label}.entries[${index}]`, code);
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 1) {
      throw new SurfaceError(code, `${label}.entries[${index}]`, 68);
    }
    actualPaths.push(entry.path);
  }
  if (!isDeepStrictEqual(actualPaths, expectedPaths)) {
    throw new SurfaceError(code, `${label}: source path order or completeness`, 68);
  }
  const framing = Buffer.concat(value.entries.map((entry) => Buffer.from(
    `${entry.path}\0${entry.sha256}\0${entry.bytes}\n`,
    "utf8",
  )));
  if (
    value.sha256 !== sha256(framing)
    || value.bytes !== framing.byteLength
  ) {
    throw new SurfaceError(code, `${label}: aggregate framing`, 68);
  }
  return value;
}

function validateSourceIntegrityDocument(value, label) {
  assertExactKeys(
    value,
    ["schemaVersion", "count", "entries", "framingBytes", "aggregateSha256"],
    label,
    "FINALIZATION_SOURCE_INTEGRITY_INVALID",
  );
  if (value.schemaVersion !== 1) {
    throw new SurfaceError("FINALIZATION_SOURCE_INTEGRITY_INVALID", `${label}: schemaVersion`, 68);
  }
  return validateSourceAggregate({
    count: value.count,
    entries: value.entries,
    sha256: value.aggregateSha256,
    bytes: value.framingBytes,
  }, label);
}

function validateArtifactRecords(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length !== FINALIZATION_ARTIFACT_PATHS.length) {
    throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", "artifacts: exact count", 68);
  }
  const paths = [];
  for (const [index, artifact] of artifacts.entries()) {
    const allowEmpty = FINALIZATION_LOG_PATHS.includes(artifact?.path);
    assertArtifactRecord(artifact, `artifacts[${index}]`, { allowEmpty });
    paths.push(artifact.path);
  }
  if (!isDeepStrictEqual(paths, FINALIZATION_ARTIFACT_PATHS)) {
    throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", "artifacts: bytewise order or completeness", 68);
  }
  return new Map(artifacts.map((artifact) => [artifact.path, artifact]));
}

function validateFinalizationManifest(manifest) {
  assertExactKeys(manifest, [
    "schemaVersion", "unit", "phase", "runId", "runContext", "authority", "gate36SectionSha256",
    "gate37SectionSha256", "gate38SectionSha256", "gate39SectionSha256", "gate40SectionSha256",
    "gate41SectionSha256",
    "ownership", "invocationCount",
    "ports", "sourceIntegrity", "sourceAggregate", "focusedLogs", "lifecycle", "captures",
    "observedCounters", "webEnvReadAudit", "pptx", "stagedProductPaths", "artifacts", "residualState",
  ], "manifest");
  assertExactKeys(
    manifest.authority,
    ["bodySha256", "dispatchSha256"],
    "authority",
  );
  assertExactKeys(manifest.ownership, ["READ_ONLY", "MODIFY", "CREATE", "total", "writable"], "ownership");
  assertExactKeys(manifest.ports, SERVICE_NAMES, "ports");
  assertExactKeys(manifest.sourceIntegrity, ["before", "after"], "sourceIntegrity");
  assertExactKeys(manifest.focusedLogs, ["workflow", "engineer", "business", "testCounts"], "focusedLogs");
  assertExactKeys(manifest.focusedLogs.testCounts, ["workflow", "engineer", "business"], "focusedLogs.testCounts");
  assertExactKeys(manifest.lifecycle, ["processes", "cleanup", "result"], "lifecycle");
  assertExactKeys(manifest.captures, ["apiToInfra", "bridgeToChild"], "captures");
  assertExactKeys(manifest.pptx, ["path", "sha256", "bytes", "sourceAbsent"], "pptx");
  const artifactMap = validateArtifactRecords(manifest.artifacts);
  validateSourceAggregate(manifest.sourceAggregate, "manifest.sourceAggregate");
  const { runContext } = parseRunContext(manifest.runContext, "manifest.runContext");
  if (manifest.runId !== runContext.expectedRunId) {
    throw new SurfaceError("FINAL_RUN_CONTEXT_MISMATCH", "manifest legacy runId", 68);
  }
  if (
    manifest.schemaVersion !== 1
    || manifest.unit !== "U002"
    || manifest.phase !== "AWAITING_EXTERNAL_REVIEWS"
    || typeof manifest.runId !== "string"
    || manifest.runId.trim().length === 0
    || manifest.authority.bodySha256 !== AUTHORITY_BODY_SHA256
    || manifest.authority.dispatchSha256 !== DISPATCH_SHA256
    || manifest.gate36SectionSha256 !== GATE36_SECTION_SHA256
    || manifest.gate37SectionSha256 !== GATE37_SECTION_SHA256
    || manifest.gate38SectionSha256 !== GATE38_SECTION_SHA256
    || manifest.gate39SectionSha256 !== GATE39_SECTION_SHA256
    || manifest.gate40SectionSha256 !== GATE40_SECTION_SHA256
    || manifest.gate41SectionSha256 !== GATE41_SECTION_SHA256
    || !isDeepStrictEqual(manifest.ownership, { READ_ONLY: 8, MODIFY: 57, CREATE: 31, total: 96, writable: 88 })
    || manifest.invocationCount !== 1
    || Object.values(manifest.ports).some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    || new Set(Object.values(manifest.ports)).size !== 5
    || !Array.isArray(manifest.stagedProductPaths)
    || manifest.stagedProductPaths.length !== 0
    || manifest.pptx.sourceAbsent !== true
    || Object.values(manifest.focusedLogs.testCounts).some((count) => !Number.isInteger(count) || count <= 0)
    || manifest.residualState !== "MANUAL_EXTERNAL_PENDING"
  ) {
    throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", "phase-one contract mismatch", 68);
  }
  const requiredReferences = [
    ["sourceIntegrity.before", manifest.sourceIntegrity.before, "source-integrity-before.json"],
    ["sourceIntegrity.after", manifest.sourceIntegrity.after, "source-integrity-after.json"],
    ["focusedLogs.workflow", manifest.focusedLogs.workflow, "readiness-workflow-focused.log"],
    ["focusedLogs.engineer", manifest.focusedLogs.engineer, "readiness-engineer-focused.log"],
    ["focusedLogs.business", manifest.focusedLogs.business, "post-gate32-business-focused.log"],
    ["lifecycle.processes", manifest.lifecycle.processes, "real-surface/processes.json"],
    ["lifecycle.cleanup", manifest.lifecycle.cleanup, "real-surface/cleanup.json"],
    ["lifecycle.result", manifest.lifecycle.result, "real-surface/result.json"],
    ["captures.apiToInfra", manifest.captures.apiToInfra, "real-surface/captures/api-to-infra.json"],
    ["captures.bridgeToChild", manifest.captures.bridgeToChild, "real-surface/captures/bridge-to-child.json"],
    ["observedCounters", manifest.observedCounters, "real-surface/observed-counters.json"],
    ["webEnvReadAudit", manifest.webEnvReadAudit, "real-surface/web-env-read-audit.json"],
  ];
  for (const [label, value, expectedPath] of requiredReferences) {
    assertArtifactRecord(value, label);
    const listed = artifactMap.get(expectedPath);
    if (value.path !== expectedPath || !isDeepStrictEqual(value, listed)) {
      throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", `${label}: artifact binding`, 68);
    }
  }
  const pptxRecord = { path: manifest.pptx.path, sha256: manifest.pptx.sha256, bytes: manifest.pptx.bytes };
  assertArtifactRecord(pptxRecord, "pptx");
  if (!isDeepStrictEqual(pptxRecord, artifactMap.get("generated-pptx/Sangfor_설정가이드_MCP.pptx"))) {
    throw new SurfaceError("FINALIZATION_MANIFEST_INVALID", "pptx: artifact binding", 68);
  }
  return artifactMap;
}

function decodeStableText(handle, label, code) {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(handle.bytes);
    if (value.includes("\r")) throw new TypeError("CR bytes are not canonical");
    return value;
  } catch (error) {
    throw new SurfaceError(code, `${label}: ${error instanceof Error ? error.message : String(error)}`, 68);
  }
}

function parseStableJson(handle, label, code) {
  const text = decodeStableText(handle, label, code);
  try {
    const value = JSON.parse(text);
    if (text !== `${JSON.stringify(value, null, 2)}\n`) {
      throw new TypeError("JSON is not canonical UTF-8 plus one LF");
    }
    return value;
  } catch (error) {
    throw new SurfaceError(code, `${label}: ${error instanceof Error ? error.message : String(error)}`, 68);
  }
}

function parseRunContext(value, label, code = "FINAL_RUN_CONTEXT_INVALID") {
  assertExactKeys(value, ["expectedRunId", "expectedRunStartNs"], label, code);
  if (
    typeof value.expectedRunId !== "string"
    || value.expectedRunId.trim().length === 0
    || typeof value.expectedRunStartNs !== "string"
    || !/^[1-9][0-9]*$/u.test(value.expectedRunStartNs)
  ) {
    throw new SurfaceError(code, label, 68);
  }
  let expectedRunStartNs;
  try {
    expectedRunStartNs = BigInt(value.expectedRunStartNs);
  } catch {
    throw new SurfaceError(code, label, 68);
  }
  if (expectedRunStartNs <= 0n) throw new SurfaceError(code, label, 68);
  return { runContext: value, expectedRunStartNs };
}

function parsePriorRunIds(value, label) {
  if (
    !Array.isArray(value)
    || value.some((runId) => typeof runId !== "string" || runId.trim().length === 0)
    || !isDeepStrictEqual(value, bytewiseSorted(new Set(value)))
  ) {
    throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", label, 68);
  }
  return value;
}

function priorAttemptRoots(attemptRoot) {
  const currentMatch = /^attempt-([1-9][0-9]*)$/u.exec(basename(attemptRoot));
  if (!currentMatch) return [];
  const currentNumber = Number(currentMatch[1]);
  const parent = dirname(attemptRoot);
  return readdirSync(parent, { withFileTypes: true }).flatMap((entry) => {
    const match = /^attempt-([1-9][0-9]*)$/u.exec(entry.name);
    if (!match || Number(match[1]) >= currentNumber) return [];
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", entry.name, 68);
    }
    return [resolve(parent, entry.name)];
  });
}

function priorEvidenceRunIds(value, relativePath, expectedAttempt) {
  if (relativePath === "dispatcher/snapshot.json") {
    if (
      !isPlainRecord(value)
      || value.schemaVersion !== 1
      || value.unit !== "U002"
      || value.attempt !== expectedAttempt
      || typeof value.runId !== "string"
      || value.runId.trim().length === 0
    ) {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", relativePath, 68);
    }
    return { currentRunId: value.runId, referencedRunIds: [] };
  }
  if (relativePath === "controller-run-context.json") {
    assertExactKeys(
      value,
      ["schemaVersion", "unit", "runContext", "priorRunIds"],
      relativePath,
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
    );
    if (value.schemaVersion !== 1 || value.unit !== "U002") {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", relativePath, 68);
    }
    const { runContext } = parseRunContext(value.runContext, relativePath, "FINAL_PRIOR_RUN_EVIDENCE_INVALID");
    const referencedRunIds = parsePriorRunIds(value.priorRunIds, relativePath);
    if (referencedRunIds.includes(runContext.expectedRunId)) {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", `${relativePath}: self reference`, 68);
    }
    return { currentRunId: runContext.expectedRunId, referencedRunIds };
  }
  if (!isPlainRecord(value) || typeof value.runId !== "string" || value.runId.trim().length === 0) {
    throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", relativePath, 68);
  }
  if (!Object.hasOwn(value, "runContext")) {
    return { currentRunId: value.runId, referencedRunIds: [] };
  }
  const { runContext } = parseRunContext(value.runContext, relativePath, "FINAL_PRIOR_RUN_EVIDENCE_INVALID");
  if (runContext.expectedRunId !== value.runId) {
    throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", relativePath, 68);
  }
  return { currentRunId: value.runId, referencedRunIds: [] };
}

function parseLegacyAttempt2DispatcherSnapshot(handle) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(handle.bytes);
  } catch (error) {
    throw new SurfaceError(
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
      `dispatcher/snapshot.json: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  if (
    text.includes("\r")
    || !text.endsWith("\n")
    || text.endsWith("\n\n")
  ) {
    throw new SurfaceError(
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
      "dispatcher/snapshot.json: legacy UTF-8/LF contract failed",
      68,
    );
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SurfaceError(
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
      `dispatcher/snapshot.json: ${error instanceof Error ? error.message : String(error)}`,
      68,
    );
  }
  if (
    !isPlainRecord(value)
    || value.schemaVersion !== 1
    || value.unit !== "U002"
    || value.attempt !== 2
    || value.runId !== LEGACY_ATTEMPT2_RUN_ID
  ) {
    throw new SurfaceError(
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
      "dispatcher/snapshot.json: legacy semantic identity mismatch",
      68,
    );
  }
  // Never treat the exact legacy non-canonical bytes as general parseStableJson success.
  if (text === `${JSON.stringify(value, null, 2)}\n`) {
    throw new SurfaceError(
      "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
      "dispatcher/snapshot.json: legacy exception requires non-canonical bytes",
      68,
    );
  }
  return value;
}

function parsePriorEvidenceJson(handle, relativePath, expectedAttempt, priorRootName) {
  if (
    relativePath === "dispatcher/snapshot.json"
    && priorRootName === "attempt-2"
    && handle.sha256 === LEGACY_ATTEMPT2_DISPATCHER_SNAPSHOT_SHA256
    && handle.bytes.length === LEGACY_ATTEMPT2_DISPATCHER_SNAPSHOT_BYTES
  ) {
    return parseLegacyAttempt2DispatcherSnapshot(handle);
  }
  return parseStableJson(handle, relativePath, "FINAL_PRIOR_RUN_EVIDENCE_INVALID");
}

function derivePriorRunIds(attemptRoot, descriptors) {
  const relativePaths = [
    "dispatcher/snapshot.json",
    "controller-run-context.json",
    "finalization-manifest.json",
    "review-handoffs/surface-qa.json",
    "review-handoffs/final-code.json",
    "receipt.json",
  ];
  const runIdOwners = new Map();
  const referencedRunIds = new Set();
  for (const priorRoot of priorAttemptRoots(attemptRoot)) {
    const expectedAttempt = Number(basename(priorRoot).slice("attempt-".length));
    let attemptRunId;
    let evidenceCount = 0;
    for (const relativePath of relativePaths) {
      const path = resolveAttemptPath(priorRoot, relativePath);
      if (!directoryEntryExists(path)) continue;
      evidenceCount += 1;
      try {
        const handle = descriptors.open(priorRoot, path);
        const value = parsePriorEvidenceJson(
          handle,
          relativePath,
          expectedAttempt,
          basename(priorRoot),
        );
        const evidence = priorEvidenceRunIds(value, relativePath, expectedAttempt);
        if (attemptRunId !== undefined && attemptRunId !== evidence.currentRunId) {
          throw new SurfaceError(
            "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
            `${basename(priorRoot)}: conflicting run IDs`,
            68,
          );
        }
        attemptRunId = evidence.currentRunId;
        for (const runId of evidence.referencedRunIds) referencedRunIds.add(runId);
      } catch (error) {
        if (
          error instanceof SurfaceError
          && ["FINAL_PRIOR_RUN_EVIDENCE_INVALID", "FINALIZATION_PATH_ANCESTOR_CHANGED"].includes(error.code)
        ) {
          throw error;
        }
        throw new SurfaceError(
          "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
          `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
          68,
        );
      }
    }
    if (evidenceCount === 0 || attemptRunId === undefined) {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", `${basename(priorRoot)}: no run evidence`, 68);
    }
    const existingOwner = runIdOwners.get(attemptRunId);
    if (existingOwner !== undefined && existingOwner !== expectedAttempt) {
      throw new SurfaceError(
        "FINAL_PRIOR_RUN_EVIDENCE_INVALID",
        `${attemptRunId}: duplicate attempts ${existingOwner}/${expectedAttempt}`,
        68,
      );
    }
    runIdOwners.set(attemptRunId, expectedAttempt);
  }
  for (const runId of referencedRunIds) {
    if (!runIdOwners.has(runId)) {
      throw new SurfaceError("FINAL_PRIOR_RUN_EVIDENCE_INVALID", `${runId}: unresolved reference`, 68);
    }
  }
  return bytewiseSorted(new Set([...runIdOwners.keys(), ...referencedRunIds]));
}

function validateControllerRunContext(attemptRoot, expectedRunContext, descriptors, upperBoundNs) {
  const { runContext, expectedRunStartNs } = parseRunContext(expectedRunContext, "CLI runContext");
  const controllerPath = resolveAttemptPath(attemptRoot, "controller-run-context.json");
  const controllerHandle = descriptors.open(attemptRoot, controllerPath);
  const controller = parseStableJson(
    controllerHandle,
    "controller-run-context.json",
    "FINAL_RUN_CONTEXT_INVALID",
  );
  assertExactKeys(
    controller,
    ["schemaVersion", "unit", "runContext", "priorRunIds"],
    "controller-run-context.json",
    "FINAL_RUN_CONTEXT_INVALID",
  );
  if (controller.schemaVersion !== 1 || controller.unit !== "U002") {
    throw new SurfaceError("FINAL_RUN_CONTEXT_INVALID", "controller-run-context.json", 68);
  }
  const parsedController = parseRunContext(controller.runContext, "controller runContext");
  const controllerPriorRunIds = parsePriorRunIds(controller.priorRunIds, "controller priorRunIds");
  const derivedPriorRunIds = derivePriorRunIds(attemptRoot, descriptors);
  if (
    !isDeepStrictEqual(runContext, parsedController.runContext)
    || !isDeepStrictEqual(controllerPriorRunIds, derivedPriorRunIds)
  ) {
    throw new SurfaceError("FINAL_RUN_CONTEXT_MISMATCH", "controller/CLI/prior evidence", 68);
  }
  if (derivedPriorRunIds.includes(runContext.expectedRunId)) {
    throw new SurfaceError("FINAL_RUN_ID_REUSED", runContext.expectedRunId, 68);
  }
  if ((Number(controllerHandle.metadata.mode) & 0o777) !== 0o600) {
    throw new SurfaceError("FINAL_RUN_CONTEXT_INVALID", "controller mode", 68);
  }
  for (const field of ["mtimeNs", "ctimeNs"]) {
    if (
      controllerHandle.metadata[field] < expectedRunStartNs
      || controllerHandle.metadata[field] > upperBoundNs
    ) {
      throw new SurfaceError("FINAL_REVIEW_FRESHNESS_INVALID", `controller:${field}`, 68);
    }
  }
  return { controller, controllerHandle, expectedRunStartNs, derivedPriorRunIds };
}

export function validateRunnerRunContext(attemptDir, expectedRunContext, runnerBoundary) {
  const ownsBoundary = runnerBoundary === undefined;
  const boundary = runnerBoundary ?? captureRunnerFinalizerBoundary(attemptDir);
  if (
    typeof boundary !== "object"
    || boundary === null
    || typeof boundary.upperBoundNs !== "bigint"
    || boundary.rootBinding?.path !== resolve(attemptDir)
  ) {
    throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", resolve(attemptDir), 68);
  }
  assertAttemptRootBinding(boundary.rootBinding);
  const descriptors = createStableDescriptorSet([boundary.rootBinding]);
  let primaryError;
  try {
    const validation = validateControllerRunContext(
      resolve(attemptDir),
      expectedRunContext,
      descriptors,
      boundary.upperBoundNs,
    );
    descriptors.assertAllStable();
    return { runContext: validation.controller.runContext, priorRunIds: validation.derivedPriorRunIds };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError;
    try {
      descriptors.closeAll();
    } catch (error) {
      cleanupError = error;
    }
    if (ownsBoundary) {
      try {
        closeAttemptRootBinding(boundary.rootBinding);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) {
      if (!primaryError) throw cleanupError;
      if (primaryError instanceof Error && !Reflect.has(primaryError, "cause")) {
        primaryError.cause = cleanupError;
      }
    }
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function captureRunnerFinalizerBoundary(attemptDir) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new SurfaceError("FINALIZATION_NOFOLLOW_UNAVAILABLE", "O_NOFOLLOW", 68);
  }
  const attemptRoot = resolve(attemptDir);
  const rootBinding = openAttemptRootBinding(attemptRoot);
  const probePath = resolve(attemptRoot, `${FINALIZER_CLOCK_PROBE_PREFIX}${process.pid}`);
  let descriptor;
  let probeMetadata;
  let failure;
  try {
    assertAttemptRootBinding(rootBinding);
    try {
      descriptor = openSync(
        probePath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error instanceof Error && Reflect.has(error, "code") && error.code === "EEXIST") {
        throw new SurfaceError("FINALIZER_CLOCK_PROBE_ALREADY_EXISTS", probePath, 68);
      }
      throw error;
    }
    writeFileSync(descriptor, "u002-finalizer-clock\n", "utf8");
    fsyncSync(descriptor);
    probeMetadata = fstatSync(descriptor, { bigint: true });
    assertRegularSingleLink(probeMetadata, probePath);
    assertAttemptRootBinding(rootBinding);
  } catch (error) {
    failure = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        assertAttemptRootBinding(rootBinding);
        const currentMetadata = pathMetadata(probePath);
        const descriptorMetadata = fstatSync(descriptor, { bigint: true });
        if (!sameArtifactIdentity(currentMetadata, descriptorMetadata)) {
          throw new SurfaceError("FINALIZER_CLOCK_PROBE_CHANGED", probePath, 68);
        }
        unlinkSync(probePath);
        const unlinkedMetadata = fstatSync(descriptor, { bigint: true });
        if (
          unlinkedMetadata.dev !== descriptorMetadata.dev
          || unlinkedMetadata.ino !== descriptorMetadata.ino
          || unlinkedMetadata.nlink !== 0n
        ) {
          throw new SurfaceError("FINALIZER_CLOCK_PROBE_CHANGED", probePath, 68);
        }
        fsyncSync(rootBinding.descriptor);
        assertAttemptRootBinding(rootBinding);
      } catch (error) {
        failure ??= error;
        try {
          const currentMetadata = pathMetadata(probePath);
          const descriptorMetadata = fstatSync(descriptor, { bigint: true });
          if (sameArtifactIdentity(currentMetadata, descriptorMetadata)) {
            unlinkSync(probePath);
            fsyncSync(rootBinding.descriptor);
          }
        } catch (cleanupError) {
          if (failure instanceof Error && !Reflect.has(failure, "cause")) {
            failure.cause = cleanupError;
          }
        }
      }
      try {
        closeSync(descriptor);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure !== undefined) {
    try {
      closeAttemptRootBinding(rootBinding);
    } catch (closeError) {
      if (failure instanceof Error && !Reflect.has(failure, "cause")) {
        failure.cause = closeError;
      }
    }
    if (failure instanceof SurfaceError) throw failure;
    throw new SurfaceError(
      "FINALIZER_CLOCK_PROBE_FAILED",
      `${probePath}: ${failure instanceof Error ? failure.message : String(failure)}`,
      68,
    );
  }
  try {
    assertAttemptRootBinding(rootBinding);
    return {
      upperBoundNs: probeMetadata.mtimeNs > probeMetadata.ctimeNs
        ? probeMetadata.mtimeNs
        : probeMetadata.ctimeNs,
      rootBinding,
    };
  } catch (error) {
    try {
      closeAttemptRootBinding(rootBinding);
    } catch (closeError) {
      if (error instanceof Error && !Reflect.has(error, "cause")) {
        error.cause = closeError;
      }
    }
    throw error;
  }
}

function directoryEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ENOENT") return false;
    throw error;
  }
}

function writeJsonAtomicExclusive(
  path,
  value,
  { rootBinding, beforeLink, afterLink, afterComplete } = {},
) {
  const absolutePath = resolve(path);
  if (!rootBinding || dirname(absolutePath) !== rootBinding.path) {
    throw new SurfaceError("FINALIZATION_PATH_ESCAPE", absolutePath, 68);
  }
  const receiptName = basename(absolutePath);
  const temporaryName = `${receiptName}.tmp-${process.pid}-${randomUUID()}`;
  let temporaryMetadata;
  let complete = false;
  let operationError;
  let cleanupError;
  try {
    temporaryMetadata = heldAttemptWriteExclusive(
      rootBinding,
      temporaryName,
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    );
    beforeLink?.();
    try {
      heldAttemptLink(rootBinding, temporaryName, receiptName);
    } catch (error) {
      if (error instanceof Error && error.code === "EEXIST") {
        throw new SurfaceError("FINAL_RECEIPT_ALREADY_EXISTS", absolutePath, 68);
      }
      throw error;
    }
    fsyncHeldAttemptRoot(rootBinding);
    const linkedMetadata = heldAttemptStat(rootBinding, receiptName);
    if (
      !temporaryMetadata
      || !linkedMetadata
      || !linkedMetadata.isFile()
      || linkedMetadata.isSymbolicLink()
      || linkedMetadata.dev !== temporaryMetadata.dev
      || linkedMetadata.ino !== temporaryMetadata.ino
      || linkedMetadata.size !== temporaryMetadata.size
      || linkedMetadata.nlink !== 2n
    ) {
      throw new SurfaceError("FINAL_RECEIPT_INSTALL_CHANGED", absolutePath, 68);
    }
    afterLink?.();
    if (!heldAttemptUnlink(rootBinding, temporaryName)) {
      throw new SurfaceError("FINAL_RECEIPT_INSTALL_CHANGED", absolutePath, 68);
    }
    fsyncHeldAttemptRoot(rootBinding);
    const installedMetadata = heldAttemptStat(rootBinding, receiptName);
    if (
      !installedMetadata
      || !installedMetadata.isFile()
      || installedMetadata.isSymbolicLink()
      || installedMetadata.dev !== temporaryMetadata.dev
      || installedMetadata.ino !== temporaryMetadata.ino
      || installedMetadata.size !== temporaryMetadata.size
      || installedMetadata.nlink !== 1n
      || (Number(installedMetadata.mode) & 0o777) !== 0o600
    ) {
      throw new SurfaceError("FINAL_RECEIPT_INSTALL_CHANGED", absolutePath, 68);
    }
    afterComplete?.();
    complete = true;
  } catch (error) {
    operationError = error;
  } finally {
    let directoryChanged = false;
    try {
      if (!complete) {
        const receiptMetadata = heldAttemptStat(rootBinding, receiptName);
        if (
          receiptMetadata
          && temporaryMetadata
          && receiptMetadata.dev === temporaryMetadata.dev
          && receiptMetadata.ino === temporaryMetadata.ino
        ) {
          directoryChanged = heldAttemptUnlink(rootBinding, receiptName) || directoryChanged;
        }
      }
      directoryChanged = heldAttemptUnlink(rootBinding, temporaryName) || directoryChanged;
      if (directoryChanged) {
        fsyncHeldAttemptRoot(rootBinding);
      }
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (operationError) {
    if (
      cleanupError
      && operationError instanceof Error
      && !Reflect.has(operationError, "cause")
    ) {
      operationError.cause = cleanupError;
    }
    throw operationError;
  }
  if (cleanupError) throw cleanupError;
}

function stableRecord(handle, path) {
  return { path, sha256: handle.sha256, bytes: handle.bytes.length };
}

function assertReviewReport(handle, descriptor, manifest, manifestRecord) {
  const text = decodeStableText(handle, descriptor.report, "FINAL_REVIEW_NOT_PASS");
  const statements = text.split("\n").map((line) => line.trim().replace(/^[-*]\s+/u, ""));
  const expectedRunContextStatement = `RunContext: ${JSON.stringify(manifest.runContext)}`;
  const runContextStatements = statements.filter((statement) => statement.startsWith("RunContext: "));
  if (!isDeepStrictEqual(runContextStatements, [expectedRunContextStatement])) {
    throw new SurfaceError("FINAL_RUN_CONTEXT_MISMATCH", descriptor.report, 68);
  }
  const required = [
    "Result: PASS",
    `Review role: ${descriptor.role}`,
    `Finalization manifest: path=${manifestRecord.path} sha256=${manifestRecord.sha256} bytes=${manifestRecord.bytes}`,
    `Run ID: ${manifest.runId}`,
    expectedRunContextStatement,
    `Authority body SHA-256: ${manifest.authority.bodySha256}`,
    `Authority dispatch SHA-256: ${manifest.authority.dispatchSha256}`,
    `Authority Gate36 section SHA-256: ${manifest.gate36SectionSha256}`,
    `Authority Gate37 section SHA-256: ${manifest.gate37SectionSha256}`,
    `Authority Gate38 section SHA-256: ${manifest.gate38SectionSha256}`,
    `Authority Gate39 section SHA-256: ${manifest.gate39SectionSha256}`,
    `Authority Gate40 section SHA-256: ${manifest.gate40SectionSha256}`,
    `Authority Gate41 section SHA-256: ${manifest.gate41SectionSha256}`,
    `Source aggregate: count=${manifest.sourceAggregate.count} sha256=${manifest.sourceAggregate.sha256} bytes=${manifest.sourceAggregate.bytes}`,
    `Ports: ${JSON.stringify(manifest.ports)}`,
    "PPTX disposition: sourceAbsent=true",
    "Staged product paths: []",
    "Review provenance assurance: PROCEDURAL_LOCAL",
    "Residual state: MANUAL_EXTERNAL_PENDING",
  ];
  for (const statement of required) {
    if (statements.filter((candidate) => candidate === statement).length !== 1) {
      throw new SurfaceError("FINAL_REVIEW_NOT_PASS", `${descriptor.report}: ${statement}`, 68);
    }
  }
  const decisionStatements = statements.filter(
    (statement) => /^(?:Result|Verdict|Recommendation)\s*:/iu.test(statement),
  );
  const reviewStatements = statements.filter(
    (statement) => !statement.startsWith("Source: ") && !statement.startsWith("Artifact: "),
  );
  const contradictoryDecision = /\b(?:FAIL(?:ED|URE)?|REJECT(?:ED|ION)?|REQUEST(?:ED)?[_ -]+CHANGES|CHANGES[_ -]+REQUESTED|BLOCK(?:ED|ING)?|DENY|DENIED|NOT[_ -]+APPROVED|APPROVE|APPROVED)\b/iu;
  if (
    !isDeepStrictEqual(decisionStatements, ["Result: PASS"])
    || reviewStatements.some((statement) => contradictoryDecision.test(statement))
  ) {
    throw new SurfaceError("FINAL_REVIEW_CONTRADICTORY", descriptor.report, 68);
  }
  const sourceStatements = statements.filter((statement) => statement.startsWith("Source: "));
  const expectedSources = manifest.sourceAggregate.entries.map(
    (entry) => `Source: ${entry.path} sha256=${entry.sha256} bytes=${entry.bytes}`,
  );
  if (!isDeepStrictEqual(sourceStatements, expectedSources)) {
    throw new SurfaceError("FINAL_REVIEW_SOURCE_BINDING_INVALID", descriptor.report, 68);
  }
  const artifactStatements = statements.filter((statement) => statement.startsWith("Artifact: "));
  const expectedArtifacts = manifest.artifacts.map(
    (entry) => `Artifact: ${entry.path} sha256=${entry.sha256} bytes=${entry.bytes}`,
  );
  if (!isDeepStrictEqual(artifactStatements, expectedArtifacts)) {
    throw new SurfaceError("FINAL_REVIEW_ARTIFACT_BINDING_INVALID", descriptor.report, 68);
  }
}

function assertFreshReviewOrder(
  manifestHandle,
  pairs,
  finalizerStartedAtNs,
  expectedRunStartNs,
  artifactHandles,
) {
  const sequence = [
    manifestHandle,
    pairs[0].reportHandle,
    pairs[0].handoffHandle,
    pairs[1].reportHandle,
    pairs[1].handoffHandle,
  ];
  for (const field of ["mtimeNs", "ctimeNs"]) {
    for (const handle of [...artifactHandles, ...sequence]) {
      if (handle.metadata[field] < expectedRunStartNs) {
        throw new SurfaceError("FINAL_REVIEW_FRESHNESS_INVALID", `${handle.path}:${field}`, 68);
      }
      if (handle.metadata[field] > finalizerStartedAtNs) {
        throw new SurfaceError("FINAL_REVIEW_FUTURE_TIMESTAMP", `${handle.path}:${field}`, 68);
      }
    }
    for (let index = 1; index < sequence.length; index += 1) {
      if (sequence[index - 1].metadata[field] > sequence[index].metadata[field]) {
        throw new SurfaceError("FINAL_REVIEW_FRESHNESS_INVALID", `${field}:${index}`, 68);
      }
    }
    for (const handle of artifactHandles) {
      if (handle.metadata[field] > manifestHandle.metadata[field]) {
        throw new SurfaceError("FINALIZATION_ARTIFACT_STALE", `${handle.path}:${field}`, 68);
      }
    }
  }
  const identities = sequence.slice(1).map((handle) => `${handle.metadata.dev}:${handle.metadata.ino}`);
  if (new Set(identities).size !== identities.length) {
    throw new SurfaceError("FINAL_REVIEW_INODE_REUSED", "review/handoff inode", 68);
  }
}

function stagedProductPaths(sourceRoot) {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"], {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/u).filter(Boolean).filter((path) => !path.startsWith(".omo/evidence/"));
  } catch (error) {
    throw new SurfaceError("FINAL_STAGED_PATHS_UNREADABLE", error instanceof Error ? error.message : String(error), 68);
  }
}

export function finalizeU002Receipt(attemptDir, options = {}) {
  const boundary = captureRunnerFinalizerBoundary(attemptDir);
  const finalizerStartedAtNs = boundary.upperBoundNs;
  let primaryError;
  try {
  const sourceRoot = resolve(options.sourceRoot ?? repoRoot);
  const attemptRoot = resolve(attemptDir);
  const expectedRunContext = {
    expectedRunId: options.expectedRunId,
    expectedRunStartNs: options.expectedRunStartNs,
  };
  const receiptPath = resolve(attemptRoot, "receipt.json");
  assertAttemptRootBinding(boundary.rootBinding);
  if (heldAttemptEntryExists(boundary.rootBinding, "receipt.json")) {
    throw new SurfaceError("FINAL_RECEIPT_ALREADY_EXISTS", receiptPath, 68);
  }
  assertAttemptRootBinding(boundary.rootBinding);
  const descriptors = createStableDescriptorSet([boundary.rootBinding]);
  const manifestPath = resolveAttemptPath(attemptRoot, "finalization-manifest.json");
  try {
    const controllerValidation = validateControllerRunContext(
      attemptRoot,
      expectedRunContext,
      descriptors,
      finalizerStartedAtNs,
    );
    const manifestHandle = descriptors.open(attemptRoot, manifestPath);
    const manifest = parseStableJson(
      manifestHandle,
      "finalization-manifest.json",
      "FINALIZATION_MANIFEST_INVALID",
    );
    validateFinalizationManifest(manifest);
    if (!isDeepStrictEqual(manifest.runContext, controllerValidation.controller.runContext)) {
      throw new SurfaceError("FINAL_RUN_CONTEXT_MISMATCH", "manifest/controller", 68);
    }
    const manifestRecord = stableRecord(manifestHandle, "finalization-manifest.json");
    const staged = stagedProductPaths(sourceRoot);
    if (staged.length > 0) throw new SurfaceError("FINAL_STAGED_PRODUCT_PATHS", staged.join(","), 68);

    const artifactHandles = [];
    for (const artifact of manifest.artifacts) {
      const allowEmpty = FINALIZATION_LOG_PATHS.includes(artifact.path);
      const handle = descriptors.open(attemptRoot, resolveAttemptPath(attemptRoot, artifact.path), { allowEmpty });
      artifactHandles.push(handle);
      if (handle.sha256 !== artifact.sha256 || handle.bytes.length !== artifact.bytes) {
        throw new SurfaceError("FINALIZATION_ARTIFACT_HASH_MISMATCH", artifact.path, 68);
      }
    }
    const beforeHandle = descriptors.open(
      attemptRoot,
      resolveAttemptPath(attemptRoot, manifest.sourceIntegrity.before.path),
    );
    const afterHandle = descriptors.open(
      attemptRoot,
      resolveAttemptPath(attemptRoot, manifest.sourceIntegrity.after.path),
    );
    const beforeAggregate = validateSourceIntegrityDocument(
      parseStableJson(beforeHandle, "source-integrity-before.json", "FINALIZATION_SOURCE_INTEGRITY_INVALID"),
      "source-integrity-before.json",
    );
    const afterAggregate = validateSourceIntegrityDocument(
      parseStableJson(afterHandle, "source-integrity-after.json", "FINALIZATION_SOURCE_INTEGRITY_INVALID"),
      "source-integrity-after.json",
    );
    if (
      !isDeepStrictEqual(beforeAggregate, afterAggregate)
      || !isDeepStrictEqual(beforeAggregate, manifest.sourceAggregate)
    ) {
      throw new SurfaceError("FINALIZATION_SOURCE_INTEGRITY_INVALID", "before/after/manifest mismatch", 68);
    }

    const handoffDescriptors = [
      { name: "surface-qa.json", role: "surface-qa", order: 1, report: "surface-qa-review.md" },
      { name: "final-code.json", role: "final-code", order: 2, report: "final-code-review.md" },
    ];
    const pairs = [];
    for (const descriptor of handoffDescriptors) {
      const reportPath = resolveAttemptPath(attemptRoot, descriptor.report);
      const handoffRelativePath = `review-handoffs/${descriptor.name}`;
      const handoffPath = resolveAttemptPath(attemptRoot, handoffRelativePath);
      if (!directoryEntryExists(reportPath)) throw new SurfaceError("FINAL_REVIEW_MISSING", descriptor.report, 68);
      if (!directoryEntryExists(handoffPath)) throw new SurfaceError("FINAL_REVIEW_HANDOFF_MISSING", descriptor.name, 68);
      const reportHandle = descriptors.open(attemptRoot, reportPath);
      const handoffHandle = descriptors.open(attemptRoot, handoffPath);
      const handoff = parseStableJson(handoffHandle, descriptor.name, "FINAL_REVIEW_HANDOFF_INVALID");
      assertExactKeys(handoff, [
        "schemaVersion", "unit", "role", "verdict", "reviewOrder", "taskId", "sessionId", "runId", "runContext",
        "ports", "finalizationManifest", "authority", "sourceAggregate", "artifacts", "report",
      ], descriptor.name, "FINAL_REVIEW_HANDOFF_INVALID");
      assertExactKeys(handoff.ports, SERVICE_NAMES, `${descriptor.name}.ports`, "FINAL_REVIEW_HANDOFF_INVALID");
      assertExactKeys(
        handoff.authority,
        ["bodySha256", "dispatchSha256"],
        `${descriptor.name}.authority`,
        "FINAL_REVIEW_HANDOFF_INVALID",
      );
      assertArtifactRecord(handoff.finalizationManifest, `${descriptor.name}.finalizationManifest`);
      assertArtifactRecord(handoff.report, `${descriptor.name}.report`);
      validateSourceAggregate(handoff.sourceAggregate, `${descriptor.name}.sourceAggregate`, "FINAL_REVIEW_HANDOFF_INVALID");
      validateArtifactRecords(handoff.artifacts);
      parseRunContext(handoff.runContext, `${descriptor.name}.runContext`);
      const reportRecord = stableRecord(reportHandle, descriptor.report);
      if (
        handoff.runId !== manifest.runId
        || !isDeepStrictEqual(handoff.runContext, manifest.runContext)
      ) {
        throw new SurfaceError("FINAL_RUN_CONTEXT_MISMATCH", descriptor.name, 68);
      }
      if (
        handoff.schemaVersion !== 1
        || handoff.unit !== "U002"
        || handoff.role !== descriptor.role
        || handoff.verdict !== "PASS"
        || handoff.reviewOrder !== descriptor.order
        || typeof handoff.taskId !== "string"
        || handoff.taskId.trim().length === 0
        || typeof handoff.sessionId !== "string"
        || handoff.sessionId.trim().length === 0
        || !isDeepStrictEqual(handoff.ports, manifest.ports)
        || !isDeepStrictEqual(handoff.finalizationManifest, manifestRecord)
        || !isDeepStrictEqual(handoff.authority, manifest.authority)
        || !isDeepStrictEqual(handoff.sourceAggregate, manifest.sourceAggregate)
        || !isDeepStrictEqual(handoff.artifacts, manifest.artifacts)
        || !isDeepStrictEqual(handoff.report, reportRecord)
      ) {
        throw new SurfaceError("FINAL_REVIEW_HANDOFF_INVALID", descriptor.name, 68);
      }
      assertReviewReport(reportHandle, descriptor, manifest, manifestRecord);
      pairs.push({ descriptor, reportHandle, handoffHandle, handoff });
    }
    if (
      pairs[0].handoff.taskId === pairs[1].handoff.taskId
      || pairs[0].handoff.sessionId === pairs[1].handoff.sessionId
    ) {
      throw new SurfaceError("FINAL_REVIEW_HANDOFF_REUSED_IDENTITY", "task/session", 68);
    }
    assertFreshReviewOrder(
      manifestHandle,
      pairs,
      finalizerStartedAtNs,
      controllerValidation.expectedRunStartNs,
      artifactHandles,
    );

    const currentSourceAggregate = sourceAggregateFromDescriptors(sourceRoot, OWNED_PATHS, descriptors);
    if (!isDeepStrictEqual(currentSourceAggregate, manifest.sourceAggregate)) {
      throw new SurfaceError("FINALIZATION_SOURCE_MUTATED", "current canonical source aggregate", 68);
    }
    const canonicalSourcePaths = new Set(OWNED_PATHS.map((path) => resolveAttemptPath(sourceRoot, path)));
    for (const handle of descriptors.values()) {
      if (!canonicalSourcePaths.has(handle.path)) continue;
      if (
        handle.metadata.mtimeNs > manifestHandle.metadata.mtimeNs
        || handle.metadata.ctimeNs > manifestHandle.metadata.ctimeNs
      ) {
        throw new SurfaceError("FINALIZATION_SOURCE_STALE", relative(sourceRoot, handle.path), 68);
      }
    }
    descriptors.assertAllStable();

    const receipt = {
      schemaVersion: 1,
      unit: "U002",
      runId: manifest.runId,
      runContext: manifest.runContext,
      result: "PASS",
      authority: manifest.authority,
      gate36SectionSha256: manifest.gate36SectionSha256,
      gate37SectionSha256: manifest.gate37SectionSha256,
      gate38SectionSha256: manifest.gate38SectionSha256,
      gate39SectionSha256: manifest.gate39SectionSha256,
      gate40SectionSha256: manifest.gate40SectionSha256,
      gate41SectionSha256: manifest.gate41SectionSha256,
      ownership: manifest.ownership,
      invocationCount: 1,
      ports: manifest.ports,
      sourceIntegrity: manifest.sourceIntegrity,
      sourceAggregate: manifest.sourceAggregate,
      artifacts: manifest.artifacts,
      finalizationManifest: manifestRecord,
      reviews: Object.fromEntries(pairs.map(({ descriptor, reportHandle }) => [
        descriptor.report,
        stableRecord(reportHandle, descriptor.report),
      ])),
      reviewProvenanceAssurance: "PROCEDURAL_LOCAL",
      handoffs: Object.fromEntries(pairs.map(({ descriptor, handoffHandle }) => [
        descriptor.role,
        stableRecord(handoffHandle, `review-handoffs/${descriptor.name}`),
      ])),
      residualState: "MANUAL_EXTERNAL_PENDING",
      finalizedAt: new Date().toISOString(),
    };
    writeJsonAtomicExclusive(receiptPath, receipt, {
      rootBinding: boundary.rootBinding,
      beforeLink: () => {
        assertAttemptRootBinding(boundary.rootBinding);
        options.beforeInstall?.({ attemptDir: attemptRoot, sourceRoot });
        assertAttemptRootBinding(boundary.rootBinding);
        descriptors.assertAllStable();
      },
      afterLink: () => {
        options.afterReceiptLink?.({ attemptDir: attemptRoot, sourceRoot });
        descriptors.assertAllStable();
        assertAttemptRootBinding(boundary.rootBinding);
      },
      afterComplete: () => {
        descriptors.assertAllStable();
        assertAttemptRootBinding(boundary.rootBinding);
      },
    });
    descriptors.assertAllStable();
    return receipt;
  } finally {
    descriptors.closeAll();
  }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      closeAttemptRootBinding(boundary.rootBinding);
    } catch (error) {
      if (!primaryError) throw error;
      if (primaryError instanceof Error && !Reflect.has(primaryError, "cause")) {
        primaryError.cause = error;
      }
    }
  }
}

function parseRealSurfaceArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", `invalid argument at index ${index}`, 64);
    }
    if (values.has(key)) throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", `duplicate ${key}`, 64);
    values.set(key, value);
  }

  const approvedKeys = [
    "--run-id",
    "--expected-run-start-ns",
    "--evidence-dir",
    "--node20-bin",
    "--node22-bin",
    "--web-port",
    "--api-port",
    "--workflow-operator-port",
    "--engineer-bridge-port",
    "--engineer-operator-port",
  ];
  if (!isDeepStrictEqual(bytewiseSorted(values.keys()), bytewiseSorted(approvedKeys))) {
    throw new SurfaceError(
      "INVALID_REAL_SURFACE_ARGUMENT",
      "runner arguments must exactly match the approved key set",
      64,
    );
  }

  const evidenceDir = values.get("--evidence-dir");
  const node20Bin = values.get("--node20-bin");
  const node22Bin = values.get("--node22-bin");
  if (!isAbsolute(evidenceDir) || !isAbsolute(node20Bin) || !isAbsolute(node22Bin)) {
    throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", "evidence and Node paths must be absolute", 64);
  }

  const ports = {
    web: Number(values.get("--web-port")),
    api: Number(values.get("--api-port")),
    "workflow-operator": Number(values.get("--workflow-operator-port")),
    "engineer-bridge": Number(values.get("--engineer-bridge-port")),
    "engineer-operator": Number(values.get("--engineer-operator-port")),
  };
  if (Object.values(ports).some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", "ports must be unprivileged integers", 64);
  }
  if (new Set(Object.values(ports)).size !== SERVICE_NAMES.length) {
    throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", "ports must be distinct", 64);
  }

  const runContext = {
    expectedRunId: values.get("--run-id"),
    expectedRunStartNs: values.get("--expected-run-start-ns"),
  };
  try {
    parseRunContext(runContext, "runner runContext", "INVALID_REAL_SURFACE_ARGUMENT");
  } catch (error) {
    if (error instanceof SurfaceError) throw error;
    throw new SurfaceError("INVALID_REAL_SURFACE_ARGUMENT", "run context", 64);
  }

  return {
    runId: runContext.expectedRunId,
    runContext,
    evidenceDir,
    node20Bin,
    node22Bin,
    ports,
  };
}

function parseFinalizationArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(key)) {
      throw new SurfaceError("INVALID_FINALIZATION_ARGUMENT", `invalid argument at index ${index}`, 64);
    }
    values.set(key, value);
  }
  const expectedKeys = ["--attempt-dir", "--expected-run-id", "--expected-run-start-ns"];
  if (
    !isDeepStrictEqual(bytewiseSorted(values.keys()), bytewiseSorted(expectedKeys))
    || !isAbsolute(values.get("--attempt-dir"))
  ) {
    throw new SurfaceError(
      "INVALID_FINALIZATION_ARGUMENT",
      "expected --attempt-dir, --expected-run-id, and --expected-run-start-ns",
      64,
    );
  }
  const runContext = {
    expectedRunId: values.get("--expected-run-id"),
    expectedRunStartNs: values.get("--expected-run-start-ns"),
  };
  parseRunContext(runContext, "finalizer CLI runContext");
  return { attemptDir: values.get("--attempt-dir"), runContext };
}

function writeJson(path, value) {
  return writeExclusiveArtifactPath(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function commandResult(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    timeout: options.timeout,
    maxBuffer: 50 * 1024 * 1024,
    shell: false,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function lsofListeners(port) {
  const result = commandResult("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.error) throw new SurfaceError("LSOF_UNAVAILABLE", result.error.message);
  if (result.status !== 0 && result.status !== 1) {
    throw new SurfaceError("LSOF_FAILED", `port=${port} status=${result.status} ${result.stderr.trim()}`);
  }
  const lines = result.stdout.trim() === "" ? [] : result.stdout.trim().split(/\r?\n/u);
  return {
    commandOutput: result.stdout,
    rows: lines.slice(1).map((line) => {
      const columns = line.trim().split(/\s+/u);
      return { line, pid: Number(columns[1]), name: line };
    }),
  };
}

function processGroupRows(pgid) {
  const result = commandResult("ps", ["-axo", "pid=,pgid="]);
  if (result.status !== 0) throw new SurfaceError("PS_FAILED", result.stderr.trim());
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(([pid, group]) => Number.isInteger(pid) && group === pgid)
    .map(([pid, group]) => ({ pid, pgid: group }));
}

function pidProcessGroup(pid) {
  const result = commandResult("ps", ["-o", "pgid=", "-p", String(pid)]);
  if (result.status !== 0) return undefined;
  const pgid = Number(result.stdout.trim());
  return Number.isInteger(pgid) ? pgid : undefined;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function bindProbe(port) {
  return new Promise((resolveProbe, rejectProbe) => {
    const server = createServer();
    server.once("error", rejectProbe);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => error ? rejectProbe(error) : resolveProbe());
    });
  });
}

function requestHttp({ method = "GET", port, path, headers = {}, body }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers,
      timeout: 5_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseHeaders = Object.fromEntries(
          Object.entries(response.headers).map(([key, value]) => [key, value]),
        );
        resolveRequest({
          status: response.statusCode ?? 0,
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("timeout", () => request.destroy(new SurfaceError("HTTP_TIMEOUT", `${method} ${path}`)));
    request.once("error", rejectRequest);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function startSideEffectSpy() {
  return new Promise((resolveSpy, rejectSpy) => {
    const requests = [];
    const server = createHttpServer((request, response) => {
      requests.push({ method: request.method, path: request.url });
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"SIDE_EFFECT_SPY_CALLED"}');
    });
    server.once("error", rejectSpy);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectSpy(new SurfaceError("SIDE_EFFECT_SPY_BIND_FAILED", "missing TCP address"));
        return;
      }
      resolveSpy({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        requests,
      });
    });
  });
}

async function closeSideEffectSpy(spy) {
  if (!spy) return { started: false, requestCount: 0, rebind: "NOT_STARTED" };
  await new Promise((resolveClose, rejectClose) => {
    spy.server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  await bindProbe(spy.port);
  return {
    started: true,
    host: "127.0.0.1",
    port: spy.port,
    requestCount: spy.requests.length,
    rebind: "PASS",
  };
}

function redactRequestHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    const normalized = key.toLowerCase();
    const redacted = normalized.includes("authorization") || normalized.includes("api-key");
    return [key, redacted ? "[REDACTED]" : value];
  }));
}

function saveTranscript(requestsDir, name, request, response) {
  const transcript = {
    request: { ...request, headers: redactRequestHeaders(request.headers ?? {}) },
    response,
  };
  writeJson(join(requestsDir, `${name}.json`), transcript);
  return response;
}

function assertExactJson(response, expectedStatus, expectedBody, label) {
  if (response.status !== expectedStatus || response.body !== JSON.stringify(expectedBody)) {
    throw new SurfaceError(
      "REAL_SURFACE_ASSERTION_FAILED",
      `${label} expected ${expectedStatus} ${JSON.stringify(expectedBody)}, got ${response.status} ${response.body}`,
    );
  }
}

async function waitForOwnedListener(service, processRecord) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processRecord.exit.settled) {
      throw new SurfaceError("SERVICE_EARLY_EXIT", `${service.name} exited before readiness`);
    }
    const listeners = lsofListeners(service.port);
    if (listeners.rows.length === 1) {
      const [listener] = listeners.rows;
      const listenerPgid = pidProcessGroup(listener.pid);
      if (listenerPgid !== processRecord.pgid) {
        throw new SurfaceError(
          "FOREIGN_SERVICE_LISTENER",
          `${service.name} listener pid=${listener.pid} pgid=${listenerPgid} expected=${processRecord.pgid}`,
        );
      }
      if (!listener.name.includes(`127.0.0.1:${service.port}`)) {
        throw new SurfaceError("WILDCARD_SERVICE_LISTENER", `${service.name} listener=${listener.name}`);
      }
      return { listenerPid: listener.pid, listenerCount: 1, lsof: listeners.commandOutput };
    }
    if (listeners.rows.length > 1) {
      throw new SurfaceError("MULTIPLE_SERVICE_LISTENERS", `${service.name} count=${listeners.rows.length}`);
    }
    await delay(100);
  }
  throw new SurfaceError("SERVICE_READINESS_TIMEOUT", service.name);
}

function resolvePnpmBinary() {
  const result = commandResult("which", ["pnpm"]);
  const binary = result.stdout.trim();
  if (result.status !== 0 || !isAbsolute(binary) || !existsSync(binary)) {
    throw new SurfaceError("PNPM_BINARY_UNAVAILABLE", result.stderr.trim() || binary);
  }
  return binary;
}

function validateNodeBinary(binary, major) {
  if (!existsSync(binary)) throw new SurfaceError("NODE_BINARY_UNAVAILABLE", binary, 69);
  const result = commandResult(binary, ["--version"], { env: {} });
  if (result.status !== 0 || !result.stdout.trim().startsWith(`v${major}.`)) {
    throw new SurfaceError(
      "BLOCKED_RUNTIME_UNAVAILABLE",
      `${binary} expected Node ${major}, got ${result.stdout.trim() || result.stderr.trim()}`,
      69,
    );
  }
}

export function createServiceDefinitions(config, commonEnv, runnerSangforApiKey, webNodeOptions) {
  const webApp = resolve(repoRoot, "apps/web");
  const apiApp = resolve(repoRoot, "apps/api");
  const workflow = resolve(repoRoot, "services/sangfor-mcp-workflow");
  const engineer = resolve(repoRoot, "services/sangfor-engineer-mcp");
  const runtimeRoot = join(config.evidenceDir, "runtime");

  const definitions = [
    {
      name: "web",
      node: config.node20Bin,
      argv: [join(webApp, "node_modules/next/dist/bin/next"), "start", webApp, "-H", "127.0.0.1", "-p", String(config.ports.web)],
      cwd: join(runtimeRoot, "web"),
      port: config.ports.web,
      env: {
        ...commonEnv,
        PORT: String(config.ports.web),
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: webNodeOptions,
      },
    },
    {
      name: "engineer-bridge",
      node: config.node20Bin,
      argv: [join(engineer, "node_modules/tsx/dist/cli.mjs"), join(engineer, "apps/http-bridge/src/server.ts")],
      cwd: join(runtimeRoot, "engineer-bridge"),
      port: config.ports["engineer-bridge"],
      env: {
        ...commonEnv,
        PORT: String(config.ports["engineer-bridge"]),
        SANGFOR_API_KEY: runnerSangforApiKey,
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        TSX_TSCONFIG_PATH: join(engineer, "tsconfig.json"),
      },
    },
    {
      name: "api",
      node: config.node20Bin,
      argv: [join(apiApp, "node_modules/tsx/dist/cli.mjs"), join(apiApp, "src/index.ts")],
      cwd: join(runtimeRoot, "api"),
      port: config.ports.api,
      env: {
        ...commonEnv,
        API_PORT: String(config.ports.api),
        API_KEY: "u002-api-fixture-key-000000000000",
        FINANCE_API_KEY: "u002-finance-fixture-key-00000000",
        SANGFOR_API_KEY: runnerSangforApiKey,
        WHELP99_MCP_HTTP_URL: `http://127.0.0.1:${config.ports["engineer-bridge"]}`,
        DATABASE_URL: "postgresql://u002:u002@127.0.0.1:1/u002_gate33",
        TSX_TSCONFIG_PATH: join(apiApp, "tsconfig.json"),
      },
    },
    {
      name: "workflow-operator",
      node: config.node22Bin,
      argv: [join(workflow, "node_modules/tsx/dist/cli.mjs"), join(workflow, "apps/operator-console/src/server.ts")],
      cwd: join(runtimeRoot, "workflow-operator"),
      port: config.ports["workflow-operator"],
      env: {
        ...commonEnv,
        PORT: String(config.ports["workflow-operator"]),
        SANGFOR_API_KEY: "u002-workflow-fixture-key-00000000",
        MCP_API_KEY: "u002-workflow-mcp-fixture-00000000",
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        TSX_TSCONFIG_PATH: join(workflow, "tsconfig.json"),
      },
    },
    {
      name: "engineer-operator",
      node: config.node20Bin,
      argv: [join(engineer, "node_modules/tsx/dist/cli.mjs"), join(engineer, "apps/operator-console/src/server.ts")],
      cwd: join(runtimeRoot, "engineer-operator"),
      port: config.ports["engineer-operator"],
      env: {
        ...commonEnv,
        PORT: String(config.ports["engineer-operator"]),
        SANGFOR_API_KEY: "u002-engineer-operator-key-0000000",
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        TSX_TSCONFIG_PATH: join(engineer, "tsconfig.json"),
      },
    },
  ];

  for (const definition of definitions) mkdirSync(definition.cwd, { recursive: false });
  return definitions;
}

function exerciseUnsafeConfigurationPreflight(config, commonEnv, runtimeDir, logsDir) {
  const workflow = resolve(repoRoot, "services/sangfor-mcp-workflow");
  const definitions = createWorkflowPreflightMatrix({
    node22Bin: config.node22Bin,
    workflowRoot: workflow,
    runtimeDir,
    commonEnv: {
      ...commonEnv,
      SANGFOR_API_KEY: "u002-workflow-fixture-key-00000000",
      MCP_API_KEY: "u002-workflow-mcp-fixture-00000000",
      WHELP99_ENFORCE_SAFE_TOOLS: "true",
    },
    workflowOperatorPort: config.ports["workflow-operator"],
  });
  if (definitions.length !== 16) {
    throw new SurfaceError("UNSAFE_CONFIGURATION_MATRIX_NOT_EXACT", String(definitions.length));
  }
  const rows = definitions.map((definition) => {
    mkdirSync(definition.cwd, { recursive: false });
    const result = commandResult(definition.node, definition.argv, {
      cwd: definition.cwd,
      env: definition.env,
      timeout: 10_000,
    });
    const logName = definition.id.replaceAll(":", "-").toLowerCase();
    writeExclusiveArtifactPath(join(logsDir, `preflight-${logName}.stdout.log`), result.stdout);
    writeExclusiveArtifactPath(join(logsDir, `preflight-${logName}.stderr.log`), result.stderr);
    const listenerCount = definition.port === undefined
      ? 0
      : lsofListeners(definition.port).rows.length;
    if (
      result.error
      || result.status !== 78
      || result.signal !== null
      || result.stdout !== ""
      || result.stderr !== "UNSAFE_AUTH_CONFIGURATION\n"
      || listenerCount !== 0
    ) {
      throw new SurfaceError(
        "UNSAFE_CONFIGURATION_PREFLIGHT_FAILED",
        `${definition.id} exit=${result.status} signal=${result.signal ?? "none"} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)} listeners=${listenerCount}`,
      );
    }
    return {
      id: definition.id,
      service: definition.entrypoint,
      field: definition.field,
      variant: definition.variant,
      executable: definition.node,
      argv: definition.argv,
      cwd: definition.cwd,
      envKeys: Object.keys(definition.env).sort((left, right) => left.localeCompare(right, "en")),
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      listenerCount,
    };
  });
  writeJson(join(config.evidenceDir, "unsafe-configuration-preflight.json"), rows);
  return rows;
}

async function probeMcpProcess(definition, requests, logsDir) {
  const child = spawn(definition.node, definition.argv, {
    cwd: definition.cwd,
    env: definition.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  const pending = new Map();
  const exit = createExitState(child);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/u);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        const handler = pending.get(String(value.id));
        if (!handler) continue;
        pending.delete(String(value.id));
        handler.resolve(value);
      } catch {
        continue;
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("exit", () => {
    for (const handler of pending.values()) {
      handler.reject(new SurfaceError("MCP_PROBE_EARLY_EXIT", definition.name));
    }
    pending.clear();
  });

  const responses = [];
  let probeError;
  try {
    for (const request of requests) {
      const response = await new Promise((resolveResponse, rejectResponse) => {
        const timeout = setTimeout(() => {
          pending.delete(String(request.id));
          rejectResponse(new SurfaceError("MCP_PROBE_TIMEOUT", `${definition.name}:${request.id}`));
        }, 15_000);
        pending.set(String(request.id), {
          resolve: (value) => {
            clearTimeout(timeout);
            resolveResponse(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            rejectResponse(error);
          },
        });
        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
      responses.push(response);
    }
  } catch (error) {
    probeError = error;
  } finally {
    child.stdin.end();
    if (!exit.state.settled) child.kill("SIGTERM");
    await Promise.race([exit.promise, delay(5_000)]);
    if (!exit.state.settled) {
      child.kill("SIGKILL");
      await exit.promise;
    }
    writeExclusiveArtifactPath(join(logsDir, `${definition.name}.stdout.log`), stdout);
    writeExclusiveArtifactPath(join(logsDir, `${definition.name}.stderr.log`), stderr);
  }
  if (probeError) throw probeError;
  return {
    responses,
    exitCode: exit.state.code,
    exitSignal: exit.state.signal,
  };
}

export function createMcpProbeDefinitions(config, commonEnv, runtimeDir) {
  const workflow = resolve(repoRoot, "services/sangfor-mcp-workflow");
  const engineer = resolve(repoRoot, "services/sangfor-engineer-mcp");
  return [
    {
      name: "workflow-mcp-probe",
      node: config.node22Bin,
      argv: [join(workflow, "node_modules/tsx/dist/cli.mjs"), join(workflow, "apps/mcp-server/src/index.ts")],
      cwd: join(runtimeDir, "workflow-mcp-probe"),
      env: {
        ...commonEnv,
        MCP_API_KEY: "u002-workflow-mcp-fixture-00000000",
        SANGFOR_API_KEY: "u002-workflow-sangfor-fixture-00000000",
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        TSX_TSCONFIG_PATH: join(workflow, "tsconfig.json"),
      },
    },
    {
      name: "engineer-mcp-probe",
      node: config.node20Bin,
      argv: [join(engineer, "node_modules/tsx/dist/cli.mjs"), join(engineer, "apps/mcp-server/src/index.ts")],
      cwd: join(runtimeDir, "engineer-mcp-probe"),
      env: {
        ...commonEnv,
        SANGFOR_API_KEY: "u002-engineer-mcp-fixture-000000000",
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        TSX_TSCONFIG_PATH: join(engineer, "tsconfig.json"),
      },
    },
  ];
}

async function exerciseMcpNegativeSurface(config, commonEnv, runtimeDir, logsDir, requestsDir) {
  const methods = ["initialize", "tools/list", "tools/call"];
  const requests = methods.flatMap((method, index) => {
    const methodParams = method === "tools/call"
      ? { name: "sangfor.apply_approved_product_change", arguments: {} }
      : {};
    return [
      { jsonrpc: "2.0", id: `missing-${index}`, method, params: methodParams },
      {
        jsonrpc: "2.0",
        id: `invalid-${index}`,
        method,
        params: { ...methodParams, _meta: { apiKey: "invalid-credential" } },
      },
    ];
  });
  const definitions = createMcpProbeDefinitions(config, commonEnv, runtimeDir);
  const rows = [];
  for (const definition of definitions) {
    mkdirSync(definition.cwd, { recursive: false });
    const result = await probeMcpProcess(definition, requests, logsDir);
    for (const response of result.responses) {
      if (
        response.result !== undefined
        || response.error?.code !== -32001
        || response.error?.message !== "UNAUTHENTICATED"
      ) {
        throw new SurfaceError(
          "MCP_NEGATIVE_SURFACE_FAILED",
          `${definition.name}:${JSON.stringify(response)}`,
        );
      }
    }
    if (result.responses.length !== requests.length) {
      throw new SurfaceError(
        "MCP_NEGATIVE_SURFACE_FAILED",
        `${definition.name} responses=${result.responses.length}`,
      );
    }
    const row = {
      service: definition.name,
      executable: definition.node,
      argv: definition.argv,
      cwd: definition.cwd,
      envKeys: Object.keys(definition.env).sort((left, right) => left.localeCompare(right, "en")),
      requests,
      responses: result.responses,
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
    };
    writeJson(join(requestsDir, `${definition.name}-unauthenticated.json`), row);
    rows.push(row);
  }
  writeJson(join(config.evidenceDir, "mcp-negative-surface.json"), rows);
  return rows;
}

function createExitState(child) {
  const state = { settled: false, code: undefined, signal: undefined };
  const promise = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => {
      state.settled = true;
      state.code = code;
      state.signal = signal;
      resolveExit();
    });
  });
  return { state, promise };
}

export function writeFreshJson(path, value) {
  return writeJson(path, value);
}

function sendIpc(child, message) {
  return new Promise((resolveSend, rejectSend) => {
    if (typeof child.send !== "function" || child.connected !== true) {
      rejectSend(new SurfaceError("IPC_CHANNEL_UNAVAILABLE", message.boundary, 68));
      return;
    }
    child.send(message, (error) => {
      if (error) rejectSend(error);
      else resolveSend();
    });
  });
}

async function armIpcObservation({ record, boundary, expectedArguments, capturePath, journal }) {
  const nonce = randomUUID();
  const observation = createIpcObservation({
    boundary,
    nonce,
    deadlineAt: Date.now() + 30_000,
    expectedToolName: "sangfor.products",
    expectedArguments,
  });
  let resolveArmed;
  let rejectArmed;
  let resolveComplete;
  let rejectComplete;
  const armed = new Promise((resolveValue, rejectValue) => {
    resolveArmed = resolveValue;
    rejectArmed = rejectValue;
  });
  const complete = new Promise((resolveValue, rejectValue) => {
    resolveComplete = resolveValue;
    rejectComplete = rejectValue;
  });
  void complete.catch(() => {});
  let armedTimer;
  let completeTimer;
  const fail = (error) => {
    rejectArmed(error);
    rejectComplete(error);
  };
  const onMessage = (message) => {
    try {
      const event = acceptIpcObservation(observation, message, Date.now());
      if (event.kind === "armed") {
        clearTimeout(armedTimer);
        resolveArmed();
        return;
      }
      if (event.kind === "capture") {
        writeFreshJson(capturePath, event.capture);
        if (boundary === "api-to-infra") recordObservedEvent(journal, "infra", `ipc:${boundary}:capture`);
        else recordObservedEvent(journal, "bridge", `ipc:${boundary}:capture`);
        observation.release();
        void sendIpc(record.child, {
          protocol: IPC_PROTOCOL,
          type: "release",
          boundary,
          nonce,
        }).catch(fail);
        return;
      }
      if (event.kind === "complete") {
        clearTimeout(completeTimer);
        if (boundary === "bridge-to-child" && event.outcome === "returned") {
          recordObservedEvent(journal, "child", `ipc:${boundary}:complete`);
        }
        resolveComplete(finalizeIpcObservation(observation));
      }
    } catch (error) {
      fail(error);
    }
  };
  const onDisconnect = () => fail(new SurfaceError("IPC_CHANNEL_DISCONNECTED", boundary, 68));
  const onExit = () => fail(new SurfaceError("IPC_CHILD_EXITED", boundary, 68));
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(armedTimer);
    clearTimeout(completeTimer);
    record.child.off("message", onMessage);
    record.child.off("disconnect", onDisconnect);
    record.child.off("exit", onExit);
  };
  record.child.on("message", onMessage);
  record.child.once("disconnect", onDisconnect);
  record.child.once("exit", onExit);
  armedTimer = setTimeout(
    () => fail(new SurfaceError("IPC_ARM_TIMEOUT", boundary, 68)),
    10_000,
  );
  completeTimer = setTimeout(
    () => fail(new SurfaceError("IPC_CAPTURE_TIMEOUT", boundary, 68)),
    30_000,
  );
  try {
    await sendIpc(record.child, { protocol: IPC_PROTOCOL, type: "arm", boundary, nonce });
    await armed;
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    complete,
    dispose,
  };
}

async function createActualChainCaptureCoordinator(records, capturesDir, journal) {
  const api = records.find((record) => record.service === "api");
  const bridge = records.find((record) => record.service === "engineer-bridge");
  if (!api || !bridge) throw new SurfaceError("IPC_SERVICE_RECORD_MISSING", "api/engineer-bridge", 68);
  const apiHandle = await armIpcObservation({
    record: api,
    boundary: "api-to-infra",
    expectedArguments: { keep: "value", nested: { values: [{}, {}] } },
    capturePath: join(capturesDir, "api-to-infra.json"),
    journal,
  });
  let bridgeHandle;
  try {
    bridgeHandle = await armIpcObservation({
      record: bridge,
      boundary: "bridge-to-child",
      expectedArguments: {
        keep: "value",
        nested: { values: [{}, {}] },
        actorId: "u002-local-operator",
      },
      capturePath: join(capturesDir, "bridge-to-child.json"),
      journal,
    });
  } catch (error) {
    apiHandle.dispose();
    throw error;
  }
  const handles = [apiHandle, bridgeHandle];
  return {
    complete: Promise.all(handles.map((handle) => handle.complete)),
    dispose() {
      for (const handle of handles) handle.dispose();
    },
  };
}

export async function spawnService(service, ownership) {
  const {
    logsDir,
    processRecordsPath,
    publicRecords,
    ownedRecords,
    hooks = {},
  } = ownership;
  const writeProcessRecords = hooks.writeJson ?? writeJson;
  const resolveProcessGroup = hooks.pidProcessGroup ?? pidProcessGroup;
  const stdoutPath = join(logsDir, `${service.name}.stdout.log`);
  const stderrPath = join(logsDir, `${service.name}.stderr.log`);
  const stdoutFd = openSync(stdoutPath, "wx");
  const stderrFd = openSync(stderrPath, "wx");
  let child;
  try {
    const ipcEnabled = service.name === "api" || service.name === "engineer-bridge";
    child = spawn(service.node, service.argv, {
      cwd: service.cwd,
      env: service.env,
      detached: true,
      shell: false,
      stdio: ipcEnabled
        ? ["ignore", stdoutFd, stderrFd, "ipc"]
        : ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (!child.pid) throw new SurfaceError("MISSING_SERVICE_PID", service.name);

  const exit = createExitState(child);
  const record = {
    service: service.name,
    child,
    pid: child.pid,
    pgid: child.pid,
    exit: exit.state,
    exitPromise: exit.promise,
    port: service.port,
  };
  ownedRecords.push(record);
  await hooks.afterOwnershipRegistered?.(record);
  const publicRecord = {
    service: service.name,
    pid: child.pid,
    pgid: child.pid,
    executable: service.node,
    argv: service.argv,
    envKeys: Object.keys(service.env).sort((left, right) => left.localeCompare(right, "en")),
    cwd: service.cwd,
    port: service.port,
    ipc: service.name === "api" || service.name === "engineer-bridge",
    startedAt: new Date().toISOString(),
    stdout: stdoutPath,
    stderr: stderrPath,
  };
  publicRecords.push(publicRecord);
  writeProcessRecords(processRecordsPath, publicRecords);

  const groupDeadline = Date.now() + 2_000;
  while (Date.now() < groupDeadline && resolveProcessGroup(child.pid) === undefined && !exit.state.settled) {
    await delay(20);
  }
  const actualPgid = resolveProcessGroup(child.pid);
  if (actualPgid !== child.pid) {
    throw new SurfaceError("PID_PGID_MISMATCH", `${service.name} pid=${child.pid} pgid=${actualPgid}`);
  }
  return { record, publicRecord };
}

async function waitForGroupGone(pgid, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (processGroupRows(pgid).length === 0) return true;
    await delay(50);
  }
  return processGroupRows(pgid).length === 0;
}

export async function cleanupOne(record) {
  let shutdownSignal = "SIGTERM";
  let forcedKill = false;
  try {
    process.kill(-record.pgid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ESRCH") throw error;
  }

  if (!(await waitForGroupGone(record.pgid, 10_000))) {
    forcedKill = true;
    shutdownSignal = "SIGKILL";
    try {
      process.kill(-record.pgid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ESRCH") throw error;
    }
    if (!(await waitForGroupGone(record.pgid, 10_000))) {
      throw new SurfaceError("SERVICE_GROUP_SURVIVED_SIGKILL", record.service, 68);
    }
  }

  await Promise.race([record.exitPromise, delay(1_000)]);
  let pidAbsent = false;
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ESRCH") pidAbsent = true;
    else throw error;
  }
  if (!pidAbsent) throw new SurfaceError("SERVICE_PID_SURVIVED", record.service, 68);

  const processCount = processGroupRows(record.pgid).length;
  const listeners = lsofListeners(record.port);
  const portOwnerCount = listeners.rows.length;
  if (processCount !== 0 || portOwnerCount !== 0) {
    throw new SurfaceError(
      "SERVICE_CLEANUP_NONZERO",
      `${record.service} processes=${processCount} listeners=${portOwnerCount}`,
      68,
    );
  }
  await bindProbe(record.port);
  return {
    state: "STOPPED",
    processCount,
    listenerCount: 0,
    portOwnerCount,
    rebind: "PASS",
    shutdownSignal,
    ...(record.exit.code === null || record.exit.code === undefined
      ? { exitSignal: record.exit.signal ?? shutdownSignal }
      : { exitCode: record.exit.code }),
    forcedKill,
  };
}

export function createCleanupController(cleanup) {
  let cleanupPromise;
  const cleanupOnce = () => {
    cleanupPromise ??= Promise.resolve().then(cleanup);
    return cleanupPromise;
  };
  return {
    cleanupOnce,
    interrupt: async (signal) => ({
      signal,
      exitCode: signal === "SIGINT" ? 130 : 143,
      cleanup: await cleanupOnce(),
    }),
  };
}

export async function cleanupServices(records, ports = {}) {
  const byName = {};
  const errors = [];
  for (const record of [...records].reverse()) {
    if (Object.hasOwn(byName, record.service)) {
      errors.push(`duplicate service record: ${record.service}`);
      continue;
    }
    try {
      byName[record.service] = await cleanupOne(record);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      const listeners = lsofListeners(record.port);
      byName[record.service] = {
        state: "CLEANUP_FAILED",
        processCount: processGroupRows(record.pgid).length,
        listenerCount: listeners.rows.length,
        portOwnerCount: listeners.rows.length,
        rebind: "FAIL",
        shutdownSignal: "SIGTERM",
        exitSignal: record.exit.signal ?? null,
        forcedKill: false,
      };
    }
  }
  for (const name of SERVICE_NAMES) {
    if (!(name in byName)) {
      const port = ports[name];
      let listenerCount = 0;
      let rebind = "FAIL";
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        errors.push(`missing cleanup port: ${name}`);
      } else {
        try {
          listenerCount = lsofListeners(port).rows.length;
          await bindProbe(port);
          rebind = "PASS";
        } catch (error) {
          errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      byName[name] = {
        state: "NOT_STARTED",
        processCount: 0,
        listenerCount,
        portOwnerCount: listenerCount,
        rebind,
        shutdownSignal: null,
        exitSignal: null,
        forcedKill: false,
      };
    }
  }
  const services = Object.fromEntries(SERVICE_NAMES.map((name) => [name, byName[name]]));
  const totals = {
    processes: Object.values(services).reduce((sum, item) => sum + item.processCount, 0),
    listeners: Object.values(services).reduce((sum, item) => sum + item.listenerCount, 0),
    portOwners: Object.values(services).reduce((sum, item) => sum + item.portOwnerCount, 0),
    rebindPass: Object.values(services).filter((item) => item.rebind === "PASS").length,
  };
  const result = errors.length === 0
    && totals.processes === 0
    && totals.listeners === 0
    && totals.portOwners === 0
    && totals.rebindPass === SERVICE_NAMES.length
    ? "PASS"
    : "FAIL";
  return result === "PASS" ? { services, totals, result } : { services, totals, result, errors };
}

export async function settleRunnerCleanup({ cleanupOnce, onSigint, onSigterm, signalTarget = process }) {
  let cleanup;
  let cleanupError;
  try {
    cleanup = await cleanupOnce();
  } catch (error) {
    cleanupError = error;
  } finally {
    signalTarget.removeListener("SIGINT", onSigint);
    signalTarget.removeListener("SIGTERM", onSigterm);
  }
  return { cleanup, cleanupError };
}

export function createRunnerInterruptHandler({
  cleanupOnce,
  getPrimaryError,
  onSigint,
  onSigterm,
  signalTarget = process,
  exitProcess = (exitCode) => process.exit(exitCode),
  writeDiagnostic = (message) => process.stderr.write(message),
}) {
  let interruptPromise;
  return (signal) => {
    if (!interruptPromise) {
      interruptPromise = (async () => {
        const { cleanup, cleanupError } = await settleRunnerCleanup({
          cleanupOnce,
          onSigint,
          onSigterm,
          signalTarget,
        });
        const cleanupFailure = createCleanupFailure(getPrimaryError(), cleanup, cleanupError);
        const exitCode = cleanupFailure?.exitCode ?? (signal === "SIGINT" ? 130 : 143);
        if (cleanupFailure) {
          writeDiagnostic(`${cleanupFailure.code}: ${cleanupFailure.message}\n`);
        }
        exitProcess(exitCode);
        return { signal, exitCode, cleanup, cleanupError, cleanupFailure };
      })();
    }
    return interruptPromise;
  };
}

export function serializeErrorEvidence(error, seen = new Set()) {
  if (!(error instanceof Error)) return { name: "NonError", message: String(error) };
  if (seen.has(error)) return { name: error.name, message: "[circular cause]" };
  seen.add(error);
  const evidence = { name: error.name, message: error.message };
  if (typeof error.code === "string" || Number.isInteger(error.code)) evidence.code = error.code;
  if (Number.isInteger(error.exitCode)) evidence.exitCode = error.exitCode;
  if (error.cause !== undefined) evidence.cause = serializeErrorEvidence(error.cause, seen);
  return evidence;
}

export function createCleanupFailure(primaryError, cleanup, cleanupError) {
  if (!cleanupError && cleanup?.result === "PASS") return undefined;
  const evidence = {
    result: "FAIL",
    ...(primaryError ? { primaryFailure: serializeErrorEvidence(primaryError) } : {}),
    ...(cleanupError ? { cleanupFailure: serializeErrorEvidence(cleanupError) } : {}),
    ...(cleanup ? { cleanup } : {}),
  };
  const failure = new SurfaceError("REAL_SURFACE_CLEANUP_FAILED", JSON.stringify(evidence), 68);
  failure.cause = primaryError ?? cleanupError;
  if (cleanupError && primaryError) failure.cleanupCause = cleanupError;
  return failure;
}

function pathAbsent(path) {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if (error instanceof Error && Reflect.has(error, "code") && error.code === "ENOENT") return true;
    throw error;
  }
}

const runnerTmpdirOwnerships = new WeakMap();

function closeRunnerTmpdirOwnership(ownership) {
  let failure;
  for (const binding of [ownership.directoryBinding, ownership.parentBinding]) {
    if (binding.closed) continue;
    try {
      closeSync(binding.descriptor);
    } catch (error) {
      failure ??= error;
    }
    binding.closed = true;
  }
  if (failure) throw failure;
}

function runnerTmpdirIdentityFailure(runnerTmpdir, cause) {
  const failure = new SurfaceError("RUNNER_TMPDIR_IDENTITY_CHANGED", runnerTmpdir.logicalPath, 68);
  if (cause !== undefined) failure.cause = cause;
  return failure;
}

export function captureRunnerTmpdirOwnership(runnerTmpdir) {
  if (!runnerTmpdir || typeof runnerTmpdir.logicalPath !== "string") {
    throw new TypeError("runner tmpdir logicalPath is required");
  }
  const logicalPath = resolve(runnerTmpdir.logicalPath);
  const name = assertHeldChildName(basename(logicalPath));
  let parentBinding;
  let directoryBinding;
  let failure;
  try {
    parentBinding = openAttemptRootBinding(realpathSync(dirname(logicalPath)));
    const parentMetadata = heldAttemptStat(parentBinding, name);
    directoryBinding = openAttemptRootBinding(logicalPath);
    const descriptorMetadata = assertAttemptRootDescriptor(directoryBinding);
    if (
      !parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink()
      || !sameInodeIdentity(parentMetadata, descriptorMetadata)
    ) {
      throw runnerTmpdirIdentityFailure(runnerTmpdir);
    }
    runnerTmpdirOwnerships.set(runnerTmpdir, {
      directoryBinding,
      expectedMetadata: descriptorMetadata,
      name,
      parentBinding,
      settled: false,
    });
    return runnerTmpdir;
  } catch (error) {
    failure = error;
  }
  if (directoryBinding || parentBinding) {
    try {
      closeRunnerTmpdirOwnership({
        directoryBinding: directoryBinding ?? { closed: true },
        parentBinding: parentBinding ?? { closed: true },
      });
    } catch (error) {
      if (failure instanceof Error && !Reflect.has(failure, "cause")) failure.cause = error;
    }
  }
  throw failure;
}

function assertRunnerTmpdirIdentity(runnerTmpdir, { allowSettled = false } = {}) {
  const ownership = runnerTmpdirOwnerships.get(runnerTmpdir);
  if (!ownership || (ownership.settled && !allowSettled)) {
    throw runnerTmpdirIdentityFailure(runnerTmpdir);
  }
  let descriptorMetadata;
  let currentMetadata;
  try {
    descriptorMetadata = assertAttemptRootDescriptor(ownership.directoryBinding);
    currentMetadata = heldAttemptStat(ownership.parentBinding, ownership.name);
  } catch (error) {
    throw runnerTmpdirIdentityFailure(runnerTmpdir, error);
  }
  if (
    !sameInodeIdentity(descriptorMetadata, ownership.expectedMetadata)
    || !sameInodeIdentity(currentMetadata, ownership.expectedMetadata)
  ) {
    throw runnerTmpdirIdentityFailure(runnerTmpdir);
  }
  return ownership;
}

function cleanupRunnerTmpdir(runnerTmpdir) {
  if (!runnerTmpdir?.logicalPath) {
    return { acquired: false, logicalAbsent: true, realAbsent: true };
  }
  const ownership = runnerTmpdirOwnerships.get(runnerTmpdir);
  if (!ownership || ownership.settled) {
    throw runnerTmpdirIdentityFailure(runnerTmpdir);
  }
  ownership.settled = true;
  let failure;
  try {
    assertRunnerTmpdirIdentity(runnerTmpdir, { allowSettled: true });
    const removed = heldAttemptRemoveOwnedTree(
      ownership.parentBinding,
      ownership.name,
      ownership.expectedMetadata,
    );
    if (!removed.identityMatched || !removed.removed) {
      throw runnerTmpdirIdentityFailure(runnerTmpdir);
    }
    fsyncHeldAttemptRoot(ownership.parentBinding);
  } catch (error) {
    ownership.settled = true;
    failure = error instanceof SurfaceError && error.code === "RUNNER_TMPDIR_IDENTITY_CHANGED"
      ? error
      : runnerTmpdirIdentityFailure(runnerTmpdir, error);
  } finally {
    try {
      closeRunnerTmpdirOwnership(ownership);
    } catch (error) {
      failure ??= runnerTmpdirIdentityFailure(runnerTmpdir, error);
    }
  }
  if (failure) throw failure;
  const logicalAbsent = pathAbsent(runnerTmpdir.logicalPath);
  const realAbsent = pathAbsent(runnerTmpdir.realPath);
  if (!logicalAbsent || !realAbsent) {
    throw new SurfaceError(
      "RUNNER_TMPDIR_CLEANUP_FAILED",
      `logicalAbsent=${logicalAbsent} realAbsent=${realAbsent}`,
      68,
    );
  }
  return { ...runnerTmpdir, logicalAbsent, realAbsent };
}

export async function finalizeCleanup(
  records,
  cleanupPath,
  runnerTmpdir,
  sideEffectSpy,
  ports,
  primaryError,
  options = {},
) {
  const serviceCleanup = await cleanupServices(records, ports);
  let sideEffectSpyCleanup;
  let sideEffectSpyError;
  try {
    sideEffectSpyCleanup = await closeSideEffectSpy(sideEffectSpy);
    if (sideEffectSpyCleanup.requestCount !== 0) {
      sideEffectSpyError = `side-effect spy request count ${sideEffectSpyCleanup.requestCount}`;
    }
  } catch (error) {
    sideEffectSpyError = error instanceof Error ? error.message : String(error);
    sideEffectSpyCleanup = {
      started: Boolean(sideEffectSpy),
      requestCount: sideEffectSpy?.requests.length ?? 0,
      rebind: "FAIL",
    };
  }
  let tmpdirCleanup;
  let tmpdirError;
  try {
    tmpdirCleanup = cleanupRunnerTmpdir(runnerTmpdir);
  } catch (error) {
    const errorEvidence = serializeErrorEvidence(error);
    tmpdirError = errorEvidence.message;
    tmpdirCleanup = {
      ...runnerTmpdir,
      logicalAbsent: pathAbsent(runnerTmpdir.logicalPath),
      realAbsent: pathAbsent(runnerTmpdir.realPath),
      error: errorEvidence,
    };
  }
  const errors = [
    ...(serviceCleanup.errors ?? []),
    ...(sideEffectSpyError ? [sideEffectSpyError] : []),
    ...(tmpdirError ? [tmpdirError] : []),
  ];
  const result = serviceCleanup.result === "PASS" && errors.length === 0 ? "PASS" : "FAIL";
  const receipt = {
    services: serviceCleanup.services,
    totals: serviceCleanup.totals,
    sideEffectSpy: sideEffectSpyCleanup,
    runnerTmpdir: tmpdirCleanup,
    result,
    ...(primaryError ? { primaryFailure: serializeErrorEvidence(primaryError) } : {}),
    ...(errors.length === 0 ? {} : { errors }),
  };
  if (options.persistReceipt !== false) {
    (options.writeReceipt ?? writeJson)(cleanupPath, receipt);
  }
  return receipt;
}

function buildWeb(config, webService, logsDir) {
  const webApp = resolve(repoRoot, "apps/web");
  const buildCwd = join(config.evidenceDir, "runtime", "web-build");
  mkdirSync(buildCwd, { recursive: false });
  const argv = [join(webApp, "node_modules/next/dist/bin/next"), "build", webApp, "--webpack"];
  const result = commandResult(config.node20Bin, argv, { cwd: buildCwd, env: webService.env });
  writeExclusiveArtifactPath(join(logsDir, "web-build.stdout.log"), result.stdout);
  writeExclusiveArtifactPath(join(logsDir, "web-build.stderr.log"), result.stderr);
  writeJson(join(config.evidenceDir, "web-build.json"), {
    executable: config.node20Bin,
    argv,
    cwd: buildCwd,
    exitCode: result.status,
    signal: result.signal,
    buildIdPresent: existsSync(join(webApp, ".next", "BUILD_ID")),
  });
  if (result.error || result.status !== 0 || !existsSync(join(webApp, ".next", "BUILD_ID"))) {
    throw new SurfaceError(
      "WEB_PRODUCTION_BUILD_FAILED",
      result.error?.message ?? `exit=${result.status} signal=${result.signal ?? "none"}`,
    );
  }
}

function runFocusedSuite({ name, executable, args, cwd, env, logPath }) {
  if (existsSync(logPath)) throw new SurfaceError("FOCUSED_ARTIFACT_NOT_FRESH", logPath, 68);
  const startedAt = Date.now();
  const result = commandResult(executable, args, { cwd, env, timeout: 300_000 });
  const commandHeader = [
    `executable=${executable}`,
    `argv=${JSON.stringify(args)}`,
    `cwd=${cwd}`,
    `startedAt=${startedAt}`,
    "--- stdout ---",
  ].join("\n");
  writeFileSync(
    logPath,
    `${commandHeader}\n${result.stdout}\n--- stderr ---\n${result.stderr}\nexitCode=${result.status}\nsignal=${result.signal ?? "none"}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const endedAt = Date.now();
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new SurfaceError(
      "FOCUSED_SUITE_FAILED",
      `${name} exit=${result.status} signal=${result.signal ?? "none"} error=${result.error?.message ?? "none"}`,
      68,
    );
  }
  return {
    name,
    executable,
    argv: args,
    cwd,
    ...validateFocusedArtifact({ path: logPath, startedAt, endedAt }),
  };
}

function relocateFocusedPptx({ attemptDir, commandWindow }) {
  const sourcePath = resolve(
    repoRoot,
    "services/sangfor-engineer-mcp/outputs/Sangfor_설정가이드_MCP.pptx",
  );
  if (!existsSync(sourcePath)) {
    throw new SurfaceError("FOCUSED_PPTX_MISSING", sourcePath, 68);
  }
  const source = regularArtifact(sourcePath);
  if (source.metadata.mtimeMs < commandWindow.startedAt || Math.floor(source.metadata.mtimeMs) > commandWindow.endedAt) {
    throw new SurfaceError("FOCUSED_PPTX_STALE", sourcePath, 68);
  }
  const destinationDirectory = join(attemptDir, "generated-pptx");
  const destinationPath = join(destinationDirectory, "Sangfor_설정가이드_MCP.pptx");
  if (existsSync(destinationDirectory) || existsSync(destinationPath)) {
    throw new SurfaceError("FOCUSED_PPTX_DESTINATION_NOT_FRESH", destinationPath, 68);
  }
  mkdirSync(destinationDirectory, { recursive: false, mode: 0o700 });
  renameSync(sourcePath, destinationPath);
  const destination = regularArtifact(destinationPath);
  if (!pathAbsent(sourcePath)) throw new SurfaceError("FOCUSED_PPTX_SOURCE_REMAINS", sourcePath, 68);
  return {
    sourcePath,
    sourceAbsent: true,
    destinationPath,
    relativeDestinationPath: relative(attemptDir, destinationPath),
    sha256: destination.sha256,
    bytes: destination.bytes,
    mtime: destination.metadata.mtimeMs,
    commandWindow: {
      startedAt: commandWindow.startedAt,
      endedAt: commandWindow.endedAt,
    },
  };
}

function runFocusedSuites(config, commonEnv, pnpmBinary) {
  const attemptDir = dirname(config.evidenceDir);
  const workflowRoot = resolve(repoRoot, "services/sangfor-mcp-workflow");
  const engineerRoot = resolve(repoRoot, "services/sangfor-engineer-mcp");
  const pptxSourcePath = join(engineerRoot, "outputs/Sangfor_설정가이드_MCP.pptx");
  if (existsSync(pptxSourcePath)) {
    throw new SurfaceError("FOCUSED_PPTX_SOURCE_NOT_FRESH", pptxSourcePath, 68);
  }
  const testEnv = (nodeBinary) => ({
    PATH: `${dirname(nodeBinary)}:${dirname(pnpmBinary)}:/usr/bin:/bin`,
    HOME: commonEnv.HOME,
    TMPDIR: commonEnv.TMPDIR,
    LANG: "C",
    LC_ALL: "C",
    NODE_ENV: "test",
    // Force colorless focused-suite logs so count parsing is deterministic across
    // vitest major lines (vitest 4 engineer suite otherwise emits SGR sequences).
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    NO_PROXY: "127.0.0.1,localhost",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
  });
  const workflow = runFocusedSuite({
    name: "workflow-focused",
    executable: pnpmBinary,
    args: [
      "--dir",
      workflowRoot,
      "exec",
      "vitest",
      "run",
      "apps/operator-console/tests/auth-containment.test.ts",
      "apps/operator-console/tests/health-api.test.ts",
      "apps/operator-console/tests/server-split-regression.test.ts",
      "apps/mcp-server/src/tool-catalog.test.ts",
    ],
    cwd: repoRoot,
    env: testEnv(config.node22Bin),
    logPath: join(attemptDir, "readiness-workflow-focused.log"),
  });
  const engineer = runFocusedSuite({
    name: "engineer-focused",
    executable: pnpmBinary,
    args: ["--dir", engineerRoot, "test", "--", "--run"],
    cwd: repoRoot,
    env: testEnv(config.node20Bin),
    logPath: join(attemptDir, "readiness-engineer-focused.log"),
  });
  const pptx = relocateFocusedPptx({ attemptDir, commandWindow: engineer });
  const business = runFocusedSuite({
    name: "business-focused",
    executable: pnpmBinary,
    args: [
      "--filter",
      "@sangfor/business",
      "exec",
      "vitest",
      "run",
      "src/infrastructure/external-mutation-containment.test.ts",
      "src/infrastructure/action-connector-runtime.test.ts",
      "src/infrastructure/action-connector-runtime.observability.test.ts",
    ],
    cwd: repoRoot,
    env: testEnv(config.node20Bin),
    logPath: join(attemptDir, "post-gate32-business-focused.log"),
  });
  const result = {
    schemaVersion: 1,
    runId: config.runId,
    suites: { workflow, engineer, business },
    pptx,
  };
  writeJson(join(attemptDir, "focused-evidence-index.json"), result);
  return result;
}

async function waitForHttpResponse(request, label) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await requestHttp(request);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new SurfaceError(
    "HTTP_READINESS_TIMEOUT",
    `${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForExactJsonResponse(request, expectedStatus, expectedBody, label) {
  const deadline = Date.now() + 30_000;
  let lastObservation = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await requestHttp(request);
      lastObservation = `${response.status} ${response.body}`;
      if (response.status === expectedStatus && response.body === JSON.stringify(expectedBody)) {
        return response;
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new SurfaceError("HTTP_READINESS_TIMEOUT", `${label}: ${lastObservation}`);
}

async function exerciseHttpSurface(
  config,
  requestsDir,
  runnerSangforApiKey,
  records,
  capturesDir,
  counterJournal,
) {
  const jsonHeaders = { "content-type": "application/json" };
  const webLoginRequest = {
    method: "POST",
    port: config.ports.web,
    path: "/api/auth/login",
    headers: jsonHeaders,
    body: JSON.stringify({ email: "operator@demo.local", password: "u002-invalid-password" }),
  };
  const webLogin = saveTranscript(
    requestsDir,
    "web-login-missing-secret",
    webLoginRequest,
    await waitForHttpResponse(webLoginRequest, "web login"),
  );
  assertExactJson(webLogin, 503, { error: "AUTH_CONFIGURATION_UNAVAILABLE" }, "Web missing-secret login");
  if (webLogin.headers["set-cookie"] !== undefined) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", "Web missing-secret login set a cookie");
  }

  const apiBypassRequest = {
    method: "GET",
    port: config.ports.api,
    path: "/api/whelp99/tools",
    headers: { "x-auth-bypass-enabled": "1" },
  };
  const apiBypass = saveTranscript(
    requestsDir,
    "api-bypass-header-denied",
    apiBypassRequest,
    await waitForHttpResponse(apiBypassRequest, "API bypass denial"),
  );
  if (apiBypass.status !== 401) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `API bypass expected 401 got ${apiBypass.status}`);
  }

  const apiKeyHeaders = { "x-api-key": "u002-api-fixture-key-000000000000" };
  const financeToolsRequest = {
    method: "GET",
    port: config.ports.api,
    path: "/api/whelp99/tools",
    headers: { "x-api-key": "u002-finance-fixture-key-00000000" },
  };
  const financeTools = saveTranscript(
    requestsDir,
    "api-tools-finance-forbidden",
    financeToolsRequest,
    await requestHttp(financeToolsRequest),
  );
  if (financeTools.status !== 403) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `API finance tools expected 403 got ${financeTools.status}`);
  }

  for (const field of IDENTITY_FIELD_NAMES) {
    const cases = [
      ["root", { [field]: "caller-controlled" }],
      ["object", { nested: { [field]: "caller-controlled" } }],
      ["array", { nested: [{ [field]: "caller-controlled" }] }],
    ];
    for (const [location, argumentsValue] of cases) {
      const request = {
        method: "POST",
        port: config.ports.api,
        path: "/api/whelp99/tools/call",
        headers: { ...jsonHeaders, ...apiKeyHeaders },
        body: JSON.stringify({ name: "sangfor.products", arguments: argumentsValue }),
      };
      const response = saveTranscript(
        requestsDir,
        `api-tools-identity-conflict-${field}-${location}`,
        request,
        await requestHttp(request),
      );
      assertExactJson(response, 400, { error: "IDENTITY_CONFLICT" }, `${field} ${location}`);
    }
  }

  const liveness = [
    {
      name: "workflow-operator-health",
      port: config.ports["workflow-operator"],
      path: "/api/system/health",
    },
    {
      name: "engineer-bridge-health",
      port: config.ports["engineer-bridge"],
      path: "/health",
    },
    {
      name: "engineer-operator-health",
      port: config.ports["engineer-operator"],
      path: "/api/health/live",
    },
  ];
  for (const probe of liveness) {
    const request = { method: "GET", port: probe.port, path: probe.path, headers: {} };
    const unavailable = saveTranscript(
      requestsDir,
      `${probe.name}-not-ready`,
      request,
      await waitForHttpResponse(request, probe.name),
    );
    assertExactJson(unavailable, 503, { status: "unavailable" }, `${probe.name} not-ready`);
    const ready = saveTranscript(
      requestsDir,
      `${probe.name}-ready`,
      request,
      await waitForExactJsonResponse(request, 200, { status: "ok" }, `${probe.name} ready`),
    );
    assertExactJson(ready, 200, { status: "ok" }, `${probe.name} ready`);
  }

  const protectedRequests = [
    {
      name: "api-cfo-missing-key",
      request: {
        method: "POST",
        port: config.ports.api,
        path: "/api/cfo/popbill/issue",
        headers: jsonHeaders,
        body: "{}",
      },
    },
    {
      name: "api-cfo-wrong-key",
      request: {
        method: "POST",
        port: config.ports.api,
        path: "/api/cfo/popbill/issue",
        headers: { ...jsonHeaders, "x-api-key": "wrong" },
        body: "{}",
      },
    },
    {
      name: "workflow-config-missing-key",
      request: { method: "GET", port: config.ports["workflow-operator"], path: "/api/config", headers: {} },
    },
    {
      name: "workflow-config-wrong-key",
      request: { method: "GET", port: config.ports["workflow-operator"], path: "/api/config", headers: { "x-api-key": "wrong" } },
    },
    {
      name: "engineer-bridge-tools-missing-key",
      request: { method: "GET", port: config.ports["engineer-bridge"], path: "/tools", headers: {} },
    },
    {
      name: "engineer-bridge-tools-wrong-key",
      request: { method: "GET", port: config.ports["engineer-bridge"], path: "/tools", headers: { "x-api-key": "wrong" } },
    },
    {
      name: "engineer-operator-summary-missing-key",
      request: { method: "GET", port: config.ports["engineer-operator"], path: "/api/summary", headers: {} },
    },
    {
      name: "engineer-operator-summary-wrong-key",
      request: { method: "GET", port: config.ports["engineer-operator"], path: "/api/summary", headers: { "x-api-key": "wrong" } },
    },
  ];
  for (const probe of protectedRequests) {
    const response = saveTranscript(
      requestsDir,
      probe.name,
      probe.request,
      await requestHttp(probe.request),
    );
    if (response.status !== 401) {
      throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `${probe.name} expected 401 got ${response.status}`);
    }
  }

  const listToolsRequest = {
    method: "GET",
    port: config.ports.api,
    path: "/api/whelp99/tools",
    headers: apiKeyHeaders,
  };
  const listToolsResponse = saveTranscript(
    requestsDir,
    "api-tools-shared-key-positive",
    listToolsRequest,
    await requestHttp(listToolsRequest),
  );
  const listedTools = JSON.parse(listToolsResponse.body);
  if (listToolsResponse.status !== 200 || !Array.isArray(listedTools.tools) || listedTools.tools.length === 0) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `API tools positive got ${listToolsResponse.status} ${listToolsResponse.body}`);
  }
  recordObservedEvent(counterJournal, "toolEnumeration", "request:api-tools-shared-key-positive");

  const apiPrincipal = "apikey:default";
  const matchingIdentities = {
    keep: "value",
    approvedBy: apiPrincipal,
    nested: {
      actorId: apiPrincipal,
      requestedBy: apiPrincipal,
      values: [
        { requester: apiPrincipal, approver: apiPrincipal },
        { approverId: apiPrincipal, approverPersonaId: apiPrincipal, personaId: apiPrincipal },
      ],
    },
  };
  const callToolRequest = {
    method: "POST",
    port: config.ports.api,
    path: "/api/whelp99/tools/call",
    headers: { ...jsonHeaders, ...apiKeyHeaders },
    body: JSON.stringify({ name: "sangfor.products", arguments: matchingIdentities }),
  };
  const coordinator = await createActualChainCaptureCoordinator(records, capturesDir, counterJournal);
  let observedCallResponse;
  try {
    [observedCallResponse] = await Promise.all([
      requestHttp(callToolRequest),
      coordinator.complete,
    ]);
  } finally {
    coordinator.dispose();
  }
  const callToolResponse = saveTranscript(
    requestsDir,
    "api-tools-call-shared-key-positive",
    callToolRequest,
    observedCallResponse,
  );
  const calledTool = JSON.parse(callToolResponse.body);
  if (
    callToolResponse.status !== 200
    || calledTool.result?.isError !== false
    || !Array.isArray(calledTool.result?.structuredContent?.products)
  ) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `API tool call positive got ${callToolResponse.status} ${callToolResponse.body}`);
  }
  recordObservedEvent(counterJournal, "handlerCall", "request:api-tools-call-shared-key-positive");

  const servicePrincipal = "u002-local-operator";
  const directBridgeRequest = {
    method: "POST",
    port: config.ports["engineer-bridge"],
    path: "/tools/call",
    headers: { ...jsonHeaders, authorization: `Bearer ${runnerSangforApiKey}` },
    body: JSON.stringify({
      name: "sangfor.products",
      arguments: {
        keep: "value",
        approvedBy: servicePrincipal,
        nested: {
          actorId: servicePrincipal,
          requestedBy: servicePrincipal,
          values: [
            { requester: servicePrincipal, approver: servicePrincipal },
            { approverId: servicePrincipal, approverPersonaId: servicePrincipal, personaId: servicePrincipal },
          ],
        },
      },
    }),
  };
  const directBridgeResponse = saveTranscript(
    requestsDir,
    "engineer-bridge-equal-identity-positive",
    directBridgeRequest,
    await requestHttp(directBridgeRequest),
  );
  const directBridgeBody = JSON.parse(directBridgeResponse.body);
  if (
    directBridgeResponse.status !== 200
    || directBridgeBody.result?.isError !== false
    || !Array.isArray(directBridgeBody.result?.structuredContent?.products)
  ) {
    throw new SurfaceError("REAL_SURFACE_ASSERTION_FAILED", `direct bridge positive got ${directBridgeResponse.status} ${directBridgeResponse.body}`);
  }

  const financeForbiddenRequest = {
    method: "POST",
    port: config.ports.api,
    path: "/api/cfo/popbill/issue",
    headers: {
      ...jsonHeaders,
      "x-api-key": "u002-finance-fixture-key-00000000",
    },
    body: "{}",
  };
  const financeForbidden = saveTranscript(
    requestsDir,
    "api-finance-context-forbidden",
    financeForbiddenRequest,
    await requestHttp(financeForbiddenRequest),
  );
  assertExactJson(financeForbidden, 403, { error: "FORBIDDEN" }, "API finance context");

  const apiIdentityConflictRequest = {
    method: "POST",
    port: config.ports.api,
    path: "/api/cfo/popbill/issue",
    headers: {
      ...jsonHeaders,
      "x-api-key": "u002-api-fixture-key-000000000000",
    },
    body: JSON.stringify({ actorId: "spoofed-caller" }),
  };
  const apiIdentityConflict = saveTranscript(
    requestsDir,
    "api-spoofed-actor",
    apiIdentityConflictRequest,
    await requestHttp(apiIdentityConflictRequest),
  );
  assertExactJson(apiIdentityConflict, 400, { error: "IDENTITY_CONFLICT" }, "API spoofed actor");

  const apiContainedMutationRequest = {
    ...apiIdentityConflictRequest,
    body: JSON.stringify({ targetUrl: config.sideEffectSpyUrl }),
  };
  const apiContainedMutation = saveTranscript(
    requestsDir,
    "api-external-finance-contained",
    apiContainedMutationRequest,
    await requestHttp(apiContainedMutationRequest),
  );
  assertExactJson(
    apiContainedMutation,
    403,
    { error: "EXTERNAL_MUTATION_CONTAINED" },
    "API external finance containment",
  );

  const spoofedIdentityRequest = {
    method: "POST",
    port: config.ports["workflow-operator"],
    path: "/api/workflows/u002-fixture/approve",
    headers: {
      ...jsonHeaders,
      "x-api-key": "u002-workflow-fixture-key-00000000",
    },
    body: JSON.stringify({ approvedBy: "spoofed-caller" }),
  };
  const spoofedIdentity = saveTranscript(
    requestsDir,
    "workflow-spoofed-approver",
    spoofedIdentityRequest,
    await requestHttp(spoofedIdentityRequest),
  );
  assertExactJson(spoofedIdentity, 400, { error: "IDENTITY_CONFLICT" }, "workflow spoofed approver");

  const bridgeIdentityConflictRequest = {
    method: "POST",
    port: config.ports["engineer-bridge"],
    path: "/tools/call",
    headers: {
      ...jsonHeaders,
      authorization: `Bearer ${runnerSangforApiKey}`,
    },
    body: JSON.stringify({
      name: "sangfor.products",
      arguments: { actorId: "spoofed-caller" },
    }),
  };
  const bridgeIdentityConflict = saveTranscript(
    requestsDir,
    "engineer-bridge-spoofed-actor",
    bridgeIdentityConflictRequest,
    await requestHttp(bridgeIdentityConflictRequest),
  );
  assertExactJson(
    bridgeIdentityConflict,
    400,
    { error: "IDENTITY_CONFLICT" },
    "engineer bridge spoofed actor",
  );

  const bridgeContainedMutationRequest = {
    ...bridgeIdentityConflictRequest,
    body: JSON.stringify({
      name: "sangfor.apply_approved_product_change",
      arguments: { targetUrl: config.sideEffectSpyUrl },
    }),
  };
  const bridgeContainedMutation = saveTranscript(
    requestsDir,
    "engineer-bridge-mutation-contained",
    bridgeContainedMutationRequest,
    await requestHttp(bridgeContainedMutationRequest),
  );
  assertExactJson(
    bridgeContainedMutation,
    403,
    { error: "FORBIDDEN" },
    "engineer bridge mutation containment",
  );

  const operatorIdentityConflictRequest = {
    method: "POST",
    port: config.ports["engineer-operator"],
    path: "/api/analyze-project",
    headers: {
      ...jsonHeaders,
      "x-api-key": "u002-engineer-operator-key-0000000",
    },
    body: JSON.stringify({ customerName: "U002 fixture", actorId: "spoofed-caller" }),
  };
  const operatorIdentityConflict = saveTranscript(
    requestsDir,
    "engineer-operator-spoofed-actor",
    operatorIdentityConflictRequest,
    await requestHttp(operatorIdentityConflictRequest),
  );
  assertExactJson(
    operatorIdentityConflict,
    400,
    { error: "IDENTITY_CONFLICT" },
    "engineer operator spoofed actor",
  );

  const deniedMutationRequest = {
    method: "POST",
    port: config.ports["workflow-operator"],
    path: "/api/breakglass/request",
    headers: {
      ...jsonHeaders,
      "x-api-key": "u002-workflow-fixture-key-00000000",
    },
    body: JSON.stringify({
      reason: "u002 containment verification",
      requestedBy: "u002-local-operator",
      durationMinutes: 15,
      targetUrl: config.sideEffectSpyUrl,
    }),
  };
  const deniedMutation = saveTranscript(
    requestsDir,
    "workflow-breakglass-contained",
    deniedMutationRequest,
    await requestHttp(deniedMutationRequest),
  );
  if (deniedMutation.status !== 403) {
    throw new SurfaceError(
      "REAL_SURFACE_ASSERTION_FAILED",
      `workflow breakglass containment expected 403 got ${deniedMutation.status}`,
    );
  }
  assertExactJson(deniedMutation, 403, { error: "FORBIDDEN" }, "workflow breakglass containment");
}

function exerciseRestoreRefusal(config) {
  const attemptDir = dirname(config.evidenceDir);
  const spyDir = join(config.evidenceDir, "restore-spy-bin");
  mkdirSync(spyDir, { recursive: false });
  const spyLog = join(config.evidenceDir, "restore-psql-invocations.log");
  const psqlSpy = join(spyDir, "psql");
  writeExclusiveArtifactPath(psqlSpy, `#!/bin/sh\nprintf '%s\\n' invoked >> '${spyLog}'\nexit 99\n`);
  chmodSync(psqlSpy, 0o700);
  const cases = [
    ["loopback", "postgresql://user:pass@127.0.0.1:5434/scratch"],
    ["production-looking", "postgresql://prod:secret@db.example.invalid:5432/prod"],
    ["compose", "postgresql://postgres:postgres@postgres:5432/sangfor"],
    ["empty", ""],
  ];
  const results = [];
  for (const [name, databaseUrl] of cases) {
    const env = {
      PATH: `${spyDir}:/usr/bin:/bin`,
      DATABASE_URL: databaseUrl,
      HOME: join(config.evidenceDir, "home"),
      TMPDIR: config.runnerTmpdir,
      LANG: "C",
      LC_ALL: "C",
    };
    const shell = commandResult("/bin/sh", [resolve(repoRoot, "scripts/restore-db.sh"), "ignored-argument"], { env });
    const typescript = commandResult(config.node20Bin, [
      resolve(repoRoot, "packages/db/node_modules/tsx/dist/cli.mjs"),
      resolve(repoRoot, "packages/db/scripts/cfo-restore.ts"),
      "ignored-argument",
    ], { env });
    for (const [surface, result] of [["shell", shell], ["typescript", typescript]]) {
      if (result.status !== 64 || result.stdout !== "" || result.stderr.trim() !== "DIRECT_RESTORE_QUARANTINED_USE_U009") {
        throw new SurfaceError(
          "RESTORE_TOMBSTONE_FAILED",
          `${name}/${surface} exit=${result.status} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
        );
      }
    }
    results.push({ name, shell, typescript });
  }
  const invocationCount = existsSync(spyLog)
    ? readFileSync(spyLog, "utf8").split(/\r?\n/u).filter(Boolean).length
    : 0;
  if (invocationCount !== 0) throw new SurfaceError("RESTORE_PSQL_SPY_INVOKED", String(invocationCount));
  writeExclusiveArtifactPath(
    join(attemptDir, "restore-refusal.txt"),
    `${results.map(({ name, shell, typescript }) => `${name}: shell=${shell.status} typescript=${typescript.status}`).join("\n")}\npsqlInvocationCount=0\n`,
  );
  return { invocationCount, cases: results.length, probeCount: results.length * 2 };
}

function attemptArtifactRecord(attemptDir, path, options) {
  const artifact = regularArtifact(resolveAttemptPath(attemptDir, path), options);
  return { path, sha256: artifact.sha256, bytes: artifact.bytes };
}

function collectPhaseOneArtifacts(attemptDir) {
  const logsDirectory = resolve(attemptDir, "real-surface/logs");
  const logPaths = bytewiseSorted(readdirSync(logsDirectory).map((name) => `real-surface/logs/${name}`));
  if (!isDeepStrictEqual(logPaths, FINALIZATION_LOG_PATHS)) {
    throw new SurfaceError("FINALIZATION_LOG_SET_INVALID", logsDirectory, 68);
  }
  const requestsDirectory = resolve(attemptDir, "real-surface/requests");
  const requestPaths = bytewiseSorted(
    readdirSync(requestsDirectory).map((name) => `real-surface/requests/${name}`),
  );
  if (!isDeepStrictEqual(requestPaths, FINALIZATION_REQUEST_PATHS)) {
    throw new SurfaceError("FINALIZATION_REQUEST_TRANSCRIPTS_INVALID", requestsDirectory, 68);
  }
  const paths = FINALIZATION_ARTIFACT_PATHS.filter((path) => (
    path !== "real-surface/result.json" && path !== "surface-qa.md"
  ));
  return paths.map((path) => attemptArtifactRecord(
    attemptDir,
    path,
    { allowEmpty: FINALIZATION_LOG_PATHS.includes(path) },
  ));
}

function findArtifact(artifacts, path) {
  const artifact = artifacts.find((candidate) => candidate.path === path);
  if (!artifact) throw new SurfaceError("FINALIZATION_ARTIFACT_MISSING", path, 68);
  return artifact;
}

function writeSurfaceQa(attemptDir, config, processRecords, cleanup, artifacts) {
  const artifactLinks = artifacts.map((artifact) => (
    `- [${artifact.path}](${artifact.path}) — sha256=${artifact.sha256}, bytes=${artifact.bytes}`
  ));
  const content = [
    "# U002 real-surface QA",
    "",
    `- Run ID: ${config.runId}`,
    `- Result: ${cleanup.result}`,
    `- Process rows: ${processRecords.length}`,
    `- Cleanup totals: ${JSON.stringify(cleanup.totals)}`,
    "",
    "## Hash-verified regular artifacts",
    "",
    ...artifactLinks,
    "",
  ].join("\n");
  writeFileSync(join(attemptDir, "surface-qa.md"), content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export function validateSurfaceQaLinks(surfaceQaPath, artifacts, attemptDir = dirname(surfaceQaPath)) {
  regularArtifact(surfaceQaPath);
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new SurfaceError("SURFACE_QA_LINK_MISMATCH", "artifact set is empty", 68);
  }
  const expected = new Map();
  for (const artifact of artifacts) {
    if (
      !isPlainRecord(artifact)
      || typeof artifact.path !== "string"
      || !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")
      || !Number.isInteger(artifact.bytes)
      || artifact.bytes < 0
      || expected.has(artifact.path)
    ) {
      throw new SurfaceError("SURFACE_QA_LINK_MISMATCH", "invalid or duplicate artifact record", 68);
    }
    expected.set(artifact.path, artifact);
  }

  const source = readFileSync(surfaceQaPath, "utf8");
  const allLinks = [...source.matchAll(/\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/gu)];
  const rows = source.split(/\r?\n/u).map((line) => line.match(
    /^- \[([^\]\r\n]+)\]\(([^)\r\n]+)\) — sha256=([a-f0-9]{64}), bytes=(0|[1-9]\d*)$/u,
  )).filter(Boolean);
  if (allLinks.length !== expected.size || rows.length !== expected.size) {
    throw new SurfaceError(
      "SURFACE_QA_LINK_MISMATCH",
      `links=${allLinks.length} rows=${rows.length} artifacts=${expected.size}`,
      68,
    );
  }

  const seen = new Set();
  for (const row of rows) {
    const [, label, path, listedSha256, listedBytes] = row;
    const artifact = expected.get(path);
    if (
      label !== path
      || !artifact
      || seen.has(path)
      || listedSha256 !== artifact.sha256
      || Number(listedBytes) !== artifact.bytes
    ) {
      throw new SurfaceError("SURFACE_QA_LINK_MISMATCH", path, 68);
    }
    const current = regularArtifact(
      resolveAttemptPath(attemptDir, path),
      { allowEmpty: artifact.bytes === 0 },
    );
    if (current.sha256 !== artifact.sha256 || current.bytes !== artifact.bytes) {
      throw new SurfaceError("SURFACE_QA_LINK_MISMATCH", `${path}: artifact changed`, 68);
    }
    seen.add(path);
  }
  if (seen.size !== expected.size) {
    throw new SurfaceError("SURFACE_QA_LINK_MISMATCH", "missing artifact link", 68);
  }
  return { linkCount: seen.size, paths: bytewiseSorted(seen) };
}

export function assertRunnerFinalizationInputsFresh(attemptDir, attemptRootBinding) {
  const forbidden = [
    "finalization-manifest.json",
    "receipt.json",
    "surface-qa-review.md",
    "final-code-review.md",
    "review-handoffs/surface-qa.json",
    "review-handoffs/final-code.json",
  ];
  for (const path of forbidden) {
    if (attemptRootBinding) assertAttemptRootBinding(attemptRootBinding);
    if (directoryEntryExists(resolveAttemptPath(attemptDir, path))) {
      throw new SurfaceError("FINALIZATION_PHASE_ONE_NOT_FRESH", path, 68);
    }
  }
  if (attemptRootBinding) assertAttemptRootBinding(attemptRootBinding);
  return { checked: forbidden, created: [] };
}

export function assertRunnerOutputPathsFresh(attemptDir, attemptRootBinding) {
  const attemptRoot = resolve(attemptDir);
  const forbiddenPaths = bytewiseSorted([
    ...RUNNER_OWNED_OUTPUT_PATHS,
    ...RUNNER_FORBIDDEN_CONTROL_PATHS,
  ]);
  for (const path of forbiddenPaths) {
    if (attemptRootBinding) assertAttemptRootBinding(attemptRootBinding);
    if (directoryEntryExists(resolveAttemptPath(attemptRoot, path))) {
      throw new SurfaceError("RUNNER_OUTPUT_COLLISION", path, 64);
    }
  }
  if (attemptRootBinding) assertAttemptRootBinding(attemptRootBinding);
  const rootEntries = bytewiseSorted(readdirSync(attemptRoot));
  const unexpectedEntries = rootEntries.filter((name) => name !== "controller-run-context.json");
  if (unexpectedEntries.length !== 0) {
    throw new SurfaceError("RUNNER_OUTPUT_COLLISION", unexpectedEntries[0], 64);
  }
  if (attemptRootBinding) assertAttemptRootBinding(attemptRootBinding);
  return { checked: forbiddenPaths, allowed: ["controller-run-context.json"] };
}

export function writePhaseOneFinalizationManifest({
  attemptDir,
  config,
  artifacts,
  sourceIntegrity,
  focusedEvidence,
  attemptRootBinding,
}) {
  assertRunnerFinalizationInputsFresh(attemptDir, attemptRootBinding);
  const sourceAggregate = {
    count: sourceIntegrity.count,
    entries: sourceIntegrity.entries,
    sha256: sourceIntegrity.aggregateSha256,
    bytes: sourceIntegrity.framingBytes,
  };
  const manifest = {
    schemaVersion: 1,
    unit: "U002",
    phase: "AWAITING_EXTERNAL_REVIEWS",
    runId: config.runId,
    runContext: config.runContext,
    authority: {
      bodySha256: AUTHORITY_BODY_SHA256,
      dispatchSha256: DISPATCH_SHA256,
    },
    gate36SectionSha256: GATE36_SECTION_SHA256,
    gate37SectionSha256: GATE37_SECTION_SHA256,
    gate38SectionSha256: GATE38_SECTION_SHA256,
    gate39SectionSha256: GATE39_SECTION_SHA256,
    gate40SectionSha256: GATE40_SECTION_SHA256,
    gate41SectionSha256: GATE41_SECTION_SHA256,
    ownership: { READ_ONLY: 8, MODIFY: 57, CREATE: 31, total: 96, writable: 88 },
    invocationCount: 1,
    ports: config.ports,
    sourceIntegrity: {
      before: findArtifact(artifacts, "source-integrity-before.json"),
      after: findArtifact(artifacts, "source-integrity-after.json"),
    },
    sourceAggregate,
    focusedLogs: {
      workflow: findArtifact(artifacts, "readiness-workflow-focused.log"),
      engineer: findArtifact(artifacts, "readiness-engineer-focused.log"),
      business: findArtifact(artifacts, "post-gate32-business-focused.log"),
      testCounts: {
        workflow: focusedEvidence.suites.workflow.testCount,
        engineer: focusedEvidence.suites.engineer.testCount,
        business: focusedEvidence.suites.business.testCount,
      },
    },
    lifecycle: {
      processes: findArtifact(artifacts, "real-surface/processes.json"),
      cleanup: findArtifact(artifacts, "real-surface/cleanup.json"),
      result: findArtifact(artifacts, "real-surface/result.json"),
    },
    captures: {
      apiToInfra: findArtifact(artifacts, "real-surface/captures/api-to-infra.json"),
      bridgeToChild: findArtifact(artifacts, "real-surface/captures/bridge-to-child.json"),
    },
    observedCounters: findArtifact(artifacts, "real-surface/observed-counters.json"),
    webEnvReadAudit: findArtifact(artifacts, "real-surface/web-env-read-audit.json"),
    pptx: {
      ...findArtifact(artifacts, "generated-pptx/Sangfor_설정가이드_MCP.pptx"),
      sourceAbsent: focusedEvidence.pptx.sourceAbsent,
    },
    stagedProductPaths: [],
    artifacts,
    residualState: "MANUAL_EXTERNAL_PENDING",
  };
  validateFinalizationManifest(manifest);
  const path = join(attemptDir, "finalization-manifest.json");
  if (attemptRootBinding) {
    writeRunnerArtifactExclusive({
      rootBinding: attemptRootBinding,
      attemptDir,
      path: "finalization-manifest.json",
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    });
  } else {
    writeFreshJson(path, manifest);
  }
  return { manifest, artifact: attemptArtifactRecord(attemptDir, "finalization-manifest.json") };
}

export async function runRealSurface(config) {
  const attemptDir = dirname(config.evidenceDir);
  assertRunnerOutputPathsFresh(attemptDir);
  const boundary = captureRunnerFinalizerBoundary(attemptDir);
  const cleanupBaseline = captureRunnerAttemptCleanupBaseline(
    boundary.rootBinding,
    config.evidenceDir,
  );
  let primaryError;
  try {
    return await runRealSurfaceWithBoundary(config, attemptDir, boundary);
  } catch (error) {
    primaryError = error;
    if (error instanceof SurfaceError && error.code === "FINALIZATION_PATH_ANCESTOR_CHANGED") {
      try {
        cleanupRunnerAttemptArtifacts(boundary.rootBinding, cleanupBaseline);
      } catch (cleanupError) {
        if (error instanceof Error && !Reflect.has(error, "cause")) {
          error.cause = cleanupError;
        }
      }
    }
    throw error;
  } finally {
    try {
      closeAttemptRootBinding(boundary.rootBinding);
    } catch (error) {
      if (!primaryError) throw error;
      if (primaryError instanceof Error && !Reflect.has(primaryError, "cause")) {
        primaryError.cause = error;
      }
    }
  }
}

async function runRealSurfaceWithBoundary(config, attemptDir, runnerBoundary) {
  assertAttemptRootBinding(runnerBoundary.rootBinding);
  assertRunnerOutputPathsFresh(attemptDir, runnerBoundary.rootBinding);
  const report = scan({ emit: false, exitOnError: false });
  if (report.verdict !== "PASS" || report.phase !== "IMPLEMENTED") {
    process.stderr.write(`PLAN_DRIFT_U002_SURFACE\n${report.errors.join("\n")}\n`);
    throw new SurfaceError("PLAN_DRIFT_U002_SURFACE", "implemented scanner gate failed", 65);
  }

  validateNodeBinary(config.node20Bin, 20);
  validateNodeBinary(config.node22Bin, 22);
  validateRunnerRunContext(attemptDir, config.runContext, runnerBoundary);
  assertRunnerFinalizationInputsFresh(attemptDir, runnerBoundary.rootBinding);
  assertAttemptRootBinding(runnerBoundary.rootBinding);
  if (existsSync(config.evidenceDir)) {
    throw new SurfaceError("REAL_SURFACE_EVIDENCE_NOT_FRESH", config.evidenceDir, 64);
  }
  const homeDir = join(config.evidenceDir, "home");
  const runtimeDir = join(config.evidenceDir, "runtime");
  const logsDir = join(config.evidenceDir, "logs");
  const requestsDir = join(config.evidenceDir, "requests");
  const capturesDir = join(config.evidenceDir, "captures");
  const runnerSangforApiKey = randomBytes(32).toString("base64url");
  const records = [];
  const processRecords = [];
  const counterJournal = createObservedCounterJournal(config.runId);
  let evidenceCreated = false;
  let evidenceBinding;
  let evidenceMetadata;
  let setupComplete = false;
  const setupOwnedArtifacts = new Map();
  const setupOwnedDirectories = new Map();
  let logicalTmpdir;
  let runnerTmpdir;
  let processJournal;
  let webEnvAuditJournal;
  let sideEffectSpy;
  let focusedEvidence;
  let sourceIntegrityBefore;
  const processRecordsPath = join(config.evidenceDir, "processes.json");
  const cleanupPath = join(config.evidenceDir, "cleanup.json");
  let primaryError;
  let cleanupHookSettled = false;
  const cleanupController = createCleanupController(async () => {
    let cleanup;
    let cleanupFailure;
    try {
      cleanup = await finalizeCleanup(
        records,
        cleanupPath,
        runnerTmpdir,
        sideEffectSpy,
        config.ports,
        primaryError,
        { persistReceipt: setupComplete },
      );
    } catch (error) {
      cleanupFailure = error;
    }
    for (const journalName of ["processJournal", "webEnvAuditJournal"]) {
      const journal = journalName === "processJournal" ? processJournal : webEnvAuditJournal;
      if (!journal) continue;
      try {
        journal.close();
      } catch (error) {
        cleanupFailure ??= error;
      }
      if (journalName === "processJournal") processJournal = undefined;
      else webEnvAuditJournal = undefined;
    }
    if (!setupComplete && evidenceCreated) {
      try {
        let evidenceChanged = false;
        if (evidenceBinding) {
          for (const [name, metadata] of [...setupOwnedDirectories].reverse()) {
            const current = heldAttemptStat(evidenceBinding, name);
            if (sameInodeIdentity(current, metadata)) {
              evidenceChanged = heldAttemptRemoveTree(evidenceBinding, name) || evidenceChanged;
            }
          }
          for (const [name, metadata] of [...setupOwnedArtifacts].reverse()) {
            const current = heldAttemptStat(evidenceBinding, name);
            if (sameInodeIdentity(current, metadata)) {
              evidenceChanged = heldAttemptUnlink(evidenceBinding, name) || evidenceChanged;
            }
          }
          if (evidenceChanged) fsyncHeldAttemptRoot(evidenceBinding);
          assertAttemptRootBinding(evidenceBinding);
          if (readdirSync(config.evidenceDir).length === 0) {
            closeAttemptRootBinding(evidenceBinding);
            evidenceBinding = undefined;
            const current = heldAttemptStat(runnerBoundary.rootBinding, basename(config.evidenceDir));
            if (sameInodeIdentity(current, evidenceMetadata)) {
              heldAttemptRemoveTree(runnerBoundary.rootBinding, basename(config.evidenceDir));
              fsyncHeldAttemptRoot(runnerBoundary.rootBinding);
              evidenceCreated = false;
            }
          }
        } else {
          const evidenceName = basename(config.evidenceDir);
          const current = heldAttemptStat(runnerBoundary.rootBinding, evidenceName);
          if (sameInodeIdentity(current, evidenceMetadata)) {
            heldAttemptRemoveTree(runnerBoundary.rootBinding, evidenceName);
            fsyncHeldAttemptRoot(runnerBoundary.rootBinding);
            evidenceCreated = false;
          }
        }
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (evidenceBinding) {
      try {
        closeAttemptRootBinding(evidenceBinding);
      } catch (error) {
        cleanupFailure ??= error;
      }
      evidenceBinding = undefined;
    }
    if (!cleanupHookSettled) {
      cleanupHookSettled = true;
      try {
        await config.hooks?.onCleanupSettled?.(cleanup);
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (cleanupFailure) throw cleanupFailure;
    return cleanup;
  });
  const cleanupOnce = cleanupController.cleanupOnce;
  let interruptedSignal;
  let interrupt;
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  const handleInterrupt = createRunnerInterruptHandler({
    cleanupOnce,
    getPrimaryError: () => primaryError,
    onSigint,
    onSigterm,
  });
  interrupt = (signal) => {
    interruptedSignal ??= signal;
    return handleInterrupt(signal);
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  let cleanup;
  let cleanupError;
  try {
    mkdirSync(config.evidenceDir, { recursive: false });
    evidenceCreated = true;
    evidenceMetadata = heldAttemptStat(
      runnerBoundary.rootBinding,
      basename(config.evidenceDir),
    );
    if (!evidenceMetadata?.isDirectory() || evidenceMetadata.isSymbolicLink()) {
      throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", config.evidenceDir, 68);
    }
    assertAttemptRootBinding(runnerBoundary.rootBinding);
    evidenceBinding = openAttemptRootBinding(config.evidenceDir);
    if (
      evidenceBinding.dev !== evidenceMetadata.dev
      || evidenceBinding.ino !== evidenceMetadata.ino
    ) {
      throw new SurfaceError("FINALIZATION_PATH_ANCESTOR_CHANGED", config.evidenceDir, 68);
    }
    await config.hooks?.afterSetupAcquisition?.("mkdir", { evidenceDir: config.evidenceDir });
    logicalTmpdir = mkdtempSync("/tmp/u002-");
    runnerTmpdir = captureRunnerTmpdirOwnership({
      logicalPath: logicalTmpdir,
      realPath: logicalTmpdir,
      mode: "0700",
    });
    config.runnerTmpdir = logicalTmpdir;
    await config.hooks?.afterSetupAcquisition?.("mkdtemp", { evidenceDir: config.evidenceDir, runnerTmpdir });
    fchmodSync(assertRunnerTmpdirIdentity(runnerTmpdir).directoryBinding.descriptor, 0o700);
    await config.hooks?.afterSetupAcquisition?.("chmod", { evidenceDir: config.evidenceDir, runnerTmpdir });
    assertRunnerTmpdirIdentity(runnerTmpdir);
    runnerTmpdir.realPath = realpathSync(logicalTmpdir);
    assertRunnerTmpdirIdentity(runnerTmpdir);
    await config.hooks?.afterSetupAcquisition?.("realpath", { evidenceDir: config.evidenceDir, runnerTmpdir });
    assertRunnerTmpdirIdentity(runnerTmpdir);
    assertAttemptRootBinding(runnerBoundary.rootBinding);
    setupOwnedArtifacts.set(
      "runner-tmpdir.json",
      writeJson(join(config.evidenceDir, "runner-tmpdir.json"), runnerTmpdir),
    );
    processJournal = createOwnedJsonJournal(config.evidenceDir, "processes.json", processRecords);
    setupOwnedArtifacts.set("processes.json", processJournal.metadata);
    webEnvAuditJournal = createOwnedJsonJournal(
      config.evidenceDir,
      "web-env-read-audit.json",
      initialWebEnvReadAudit(),
    );
    setupOwnedArtifacts.set("web-env-read-audit.json", webEnvAuditJournal.metadata);
    for (const path of [homeDir, runtimeDir, logsDir, requestsDir, capturesDir]) {
      mkdirSync(path, { recursive: false });
      setupOwnedDirectories.set(basename(path), heldAttemptStat(evidenceBinding, basename(path)));
    }
    setupComplete = true;
    const pnpmBinary = resolvePnpmBinary();
    const commonEnv = {
      PATH: `${dirname(config.node20Bin)}:${dirname(pnpmBinary)}:/usr/bin:/bin`,
      HOME: homeDir,
      TMPDIR: logicalTmpdir,
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      AUTH_BYPASS_ENABLED: "0",
      SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-local-operator",
      NO_PROXY: "127.0.0.1,localhost",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
    };
    focusedEvidence = runFocusedSuites(config, commonEnv, pnpmBinary);
    sourceIntegrityBefore = buildOwnedSourceManifest(repoRoot, OWNED_PATHS);
    if (sourceIntegrityBefore.count !== 96) {
      throw new SurfaceError("SOURCE_MANIFEST_COUNT_MISMATCH", String(sourceIntegrityBefore.count), 68);
    }
    writeJson(join(attemptDir, "source-integrity-before.json"), sourceIntegrityBefore);
    const webEnvGuardPath = join(runtimeDir, "web", "env-read-guard.cjs");
    const webEnvAuditPath = join(config.evidenceDir, "web-env-read-audit.json");
    const services = createServiceDefinitions(
      config,
      commonEnv,
      runnerSangforApiKey,
      `--require=${webEnvGuardPath}`,
    );
    const webService = services.find((service) => service.name === "web");
    if (!webService) throw new SurfaceError("MISSING_SERVICE_DEFINITION", "web");
    writeWebEnvReadGuard({
      guardPath: webEnvGuardPath,
      auditPath: webEnvAuditPath,
      repository: repoRoot,
      home: homeDir,
      auditJournal: webEnvAuditJournal,
    });
    for (const service of services.filter((service) => service.name !== "web")) {
      if (Object.hasOwn(service.env, "NODE_OPTIONS")) {
        throw new SurfaceError("NON_WEB_NODE_OPTIONS_FORBIDDEN", service.name, 68);
      }
    }
    const portPreflight = [];
    for (const service of services) {
      const listeners = lsofListeners(service.port);
      if (listeners.rows.length !== 0) {
        throw new SurfaceError("PLAN_DRIFT_U002_PORT_IN_USE", `${service.name}:${service.port}`, 65);
      }
      try {
        await bindProbe(service.port);
      } catch (error) {
        throw new SurfaceError(
          "PLAN_DRIFT_U002_PORT_IN_USE",
          `${service.name}:${service.port} ${error instanceof Error ? error.message : String(error)}`,
          65,
        );
      }
      portPreflight.push({ service: service.name, port: service.port, listenerCount: 0, bind: "PASS", close: "PASS" });
    }
    writeJson(join(config.evidenceDir, "port-preflight.json"), portPreflight);
    exerciseUnsafeConfigurationPreflight(config, commonEnv, runtimeDir, logsDir);
    buildWeb(config, webService, logsDir);
    await exerciseMcpNegativeSurface(config, commonEnv, runtimeDir, logsDir, requestsDir);
    sideEffectSpy = await startSideEffectSpy();
    config.sideEffectSpyUrl = sideEffectSpy.url;
    for (const service of services) {
      const spawned = await spawnService(service, {
        logsDir,
        processRecordsPath,
        publicRecords: processRecords,
        ownedRecords: records,
        hooks: { writeJson: (_path, value) => processJournal.write(value) },
      });
      const listener = await waitForOwnedListener(service, spawned.record);
      Object.assign(spawned.publicRecord, listener);
      processJournal.write(processRecords);
    }
    await exerciseHttpSurface(
      config,
      requestsDir,
      runnerSangforApiKey,
      records,
      capturesDir,
      counterJournal,
    );
    validateWebEnvReadAudit(webEnvAuditPath);
    const restore = exerciseRestoreRefusal(config);
    if (sideEffectSpy.requests.length !== 0) {
      throw new SurfaceError(
        "EXTERNAL_SIDE_EFFECT_SPY_INVOKED",
        JSON.stringify(sideEffectSpy.requests),
      );
    }
    for (const [index] of sideEffectSpy.requests.entries()) {
      recordObservedEvent(counterJournal, "external", `loopback-http-spy:${index}`);
    }
    const requestTranscriptNames = sorted(readdirSync(requestsDir).map((path) => basename(path)));
    const externalProbeCount = requestTranscriptNames.filter((name) => (
      /(?:contained|forbidden|breakglass)/u.test(name)
    )).length;
    markObservedChannel(counterJournal, "external", "loopback-http-spy", externalProbeCount);
    markObservedChannel(counterJournal, "restore", "process-executable-spy", restore.probeCount);
    const observedCounters = finalizeObservedCounters(counterJournal);
    writeJson(join(config.evidenceDir, "observed-counters.json"), observedCounters);
    const sideEffectSpies = {
      schemaVersion: 1,
      runId: config.runId,
      loopbackExternalAdapterSpy: {
        host: "127.0.0.1",
        port: sideEffectSpy.port,
        url: sideEffectSpy.url,
        invocationCount: sideEffectSpy.requests.length,
      },
      restorePsqlInvocationCount: restore.invocationCount,
      observedCountersPath: "real-surface/observed-counters.json",
    };
    writeJson(join(attemptDir, "side-effect-spies.json"), sideEffectSpies);
    writeJson(join(attemptDir, "negative-matrix.json"), {
      schemaVersion: 1,
      runId: config.runId,
      requestTranscripts: requestTranscriptNames,
      restore,
    });
    assertAttemptRootBinding(runnerBoundary.rootBinding);
  } catch (error) {
    primaryError = error;
  } finally {
    ({ cleanup, cleanupError } = await settleRunnerCleanup({ cleanupOnce, onSigint, onSigterm }));
    try {
      assertAttemptRootBinding(runnerBoundary.rootBinding);
    } catch (error) {
      if (
        !(primaryError?.code === "FINALIZATION_PATH_ANCESTOR_CHANGED"
          && error?.code === "FINALIZATION_PATH_ANCESTOR_CHANGED")
      ) {
        cleanupError ??= error;
      }
    }
  }

  const cleanupFailure = createCleanupFailure(primaryError, cleanup, cleanupError);
  if (cleanupFailure) throw cleanupFailure;
  if (interruptedSignal) {
    throw new SurfaceError("REAL_SURFACE_INTERRUPTED", interruptedSignal, interruptedSignal === "SIGINT" ? 130 : 143);
  }
  if (primaryError) throw primaryError;

  const sourceIntegrityAfter = buildOwnedSourceManifest(repoRoot, OWNED_PATHS);
  assertAttemptRootBinding(runnerBoundary.rootBinding);
  writeJson(join(attemptDir, "source-integrity-after.json"), sourceIntegrityAfter);
  assertAttemptRootBinding(runnerBoundary.rootBinding);
  if (
    !sourceIntegrityBefore
    || sourceIntegrityBefore.count !== sourceIntegrityAfter.count
    || sourceIntegrityBefore.aggregateSha256 !== sourceIntegrityAfter.aggregateSha256
    || !isDeepStrictEqual(sourceIntegrityBefore.entries, sourceIntegrityAfter.entries)
  ) {
    throw new SurfaceError("SOURCE_INTEGRITY_CHANGED_DURING_RUN", config.runId, 68);
  }
  if (!focusedEvidence) throw new SurfaceError("FOCUSED_EVIDENCE_MISSING", config.runId, 68);

  const result = {
    schemaVersion: 1,
    unit: "U002",
    runId: config.runId,
    result: "PASS",
    services: SERVICE_NAMES,
    cleanup: cleanup.totals,
    sourceAggregateSha256: sourceIntegrityAfter.aggregateSha256,
    residualState: "MANUAL_EXTERNAL_PENDING",
  };
  const resultPath = join(config.evidenceDir, "result.json");
  let resultWritten = false;
  try {
    assertAttemptRootBinding(runnerBoundary.rootBinding);
    const artifacts = collectPhaseOneArtifacts(attemptDir);
    writeFreshJson(resultPath, result);
    resultWritten = true;
    artifacts.push(attemptArtifactRecord(attemptDir, "real-surface/result.json"));
    artifacts.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    writeSurfaceQa(attemptDir, config, processRecords, cleanup, artifacts);
    validateSurfaceQaLinks(join(attemptDir, "surface-qa.md"), artifacts, attemptDir);
    artifacts.push(attemptArtifactRecord(attemptDir, "surface-qa.md"));
    artifacts.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const phaseOne = writePhaseOneFinalizationManifest({
      attemptDir,
      config,
      artifacts,
      sourceIntegrity: sourceIntegrityAfter,
      focusedEvidence,
      attemptRootBinding: runnerBoundary.rootBinding,
    });
    assertAttemptRootBinding(runnerBoundary.rootBinding);
    process.stdout.write(`${JSON.stringify({
      ...result,
      phase: "AWAITING_EXTERNAL_REVIEWS",
      finalizationManifest: phaseOne.artifact,
      receiptCreated: false,
    }, null, 2)}\n`);
  } catch (error) {
    if (resultWritten && existsSync(resultPath)) rmSync(resultPath, { force: false });
    throw error;
  }
  assertAttemptRootBinding(runnerBoundary.rootBinding);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--finalize-receipt") {
    const finalization = parseFinalizationArgs(args.slice(1));
    const receipt = finalizeU002Receipt(finalization.attemptDir, {
      expectedRunId: finalization.runContext.expectedRunId,
      expectedRunStartNs: finalization.runContext.expectedRunStartNs,
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (args[0] !== "--real-surface") {
    scan();
    return;
  }
  const config = parseRealSurfaceArgs(args.slice(1));
  await runRealSurface(config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    if (error instanceof SurfaceError) {
      process.stderr.write(`${error.code}\n${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write(`U002_REAL_SURFACE_INTERNAL_ERROR\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 67;
    }
  }
}
