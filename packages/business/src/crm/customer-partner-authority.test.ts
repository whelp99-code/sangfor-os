import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT_MARKER = "pnpm-workspace.yaml";
const ROOTS = ["apps", "packages", "services", "scripts"] as const;
const CUSTOMER_FUNCTIONS = new Map<string, number>([
  ["listCustomers", 2],
  ["listCustomersWithOpportunities", 2],
  ["getCustomerDetail", 2],
  ["createCustomer", 2],
  ["updateCustomer", 3],
  ["archiveCustomer", 3],
]);
const OPPORTUNITY_FUNCTIONS = new Set([
  "listOpportunities",
  "getOpportunityDetail",
  "createOpportunity",
  "updateOpportunity",
  "archiveOpportunity",
  "assignOpportunityOwner",
  "convertOpportunityToProject",
  "convertMailToOpportunity",
  "advanceOpportunity",
  "processMailApproval",
]);
const WRITE_METHODS = new Set(["create", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const READ_METHODS = new Set(["findFirst", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);
const SEVEN_CUSTOMER_ADAPTERS = [
  "apps/web/src/app/api/customers/route.ts",
  "apps/web/src/app/api/customers/[id]/route.ts",
  "apps/web/src/app/(portal)/customers/page.tsx",
  "apps/web/src/app/(portal)/customers/[id]/page.tsx",
  "packages/business/src/mail/classify-ai.ts",
  "packages/business/src/mail/outlook/outlook-graph.ts",
  "packages/business/src/orchestration/portal-mvp.ts",
] as const;

function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ROOT_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`could not find ${ROOT_MARKER}`);
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const EVIDENCE_DIR = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U043/attempt-1",
);

function normalized(path: string): string {
  return path.split(sep).join("/");
}

function excluded(path: string): boolean {
  const rel = normalized(relative(REPO_ROOT, path));
  const name = basename(rel).toLowerCase();
  const segments = rel.toLowerCase().split("/");
  if (
    segments.some((segment) =>
      [".git", ".next", ".turbo", "node_modules", "dist", "build", "coverage", "generated", "vendor", "fixtures", "__fixtures__", "migrations"].includes(segment),
    )
  ) {
    return true;
  }
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /(?:^|[-_.])(fixture|verify|audit|check|smoke)(?:[-_.]|$)/.test(name)
  );
}

function productionFiles(): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    if (excluded(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (excluded(child)) continue;
      if (entry.isDirectory()) visit(child);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(child);
    }
  };
  for (const root of ROOTS) {
    const path = join(REPO_ROOT, root);
    if (existsSync(path)) visit(path);
  }
  return files.sort();
}

type ModelCall = {
  file: string;
  line: number;
  model: "customer" | "opportunity";
  method: string;
  category: "read" | "write";
};

type NamedCall = {
  file: string;
  line: number;
  name: string;
  argumentCount: number;
  hasForceTrue: boolean;
};

type SourceRecord = {
  file: string;
  imports: string[];
  exports: string[];
  modelCalls: ModelCall[];
  namedCalls: NamedCall[];
  customerHttp: boolean;
  opportunityHttp: boolean;
};

function propertyName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function hasForceTrue(node: ts.CallExpression): boolean {
  return node.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText() === "force" &&
          property.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );
}

function scanFile(path: string): SourceRecord {
  const text = readFileSync(path, "utf8");
  const file = normalized(relative(REPO_ROOT, path));
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  const exports: string[] = [];
  const modelCalls: ModelCall[] = [];
  const namedCalls: NamedCall[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      exports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (CUSTOMER_FUNCTIONS.has(name) || OPPORTUNITY_FUNCTIONS.has(name)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          namedCalls.push({
            file,
            line: line + 1,
            name,
            argumentCount: node.arguments.length,
            hasForceTrue: hasForceTrue(node),
          });
        }
      }
      const method = propertyName(node.expression);
      const modelAccess =
        (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
          ? node.expression.expression
          : null;
      const model = modelAccess ? propertyName(modelAccess) : null;
      if (
        method &&
        (model === "customer" || model === "opportunity") &&
        (WRITE_METHODS.has(method) || READ_METHODS.has(method))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        modelCalls.push({
          file,
          line: line + 1,
          model,
          method,
          category: WRITE_METHODS.has(method) ? "write" : "read",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    file,
    imports,
    exports,
    modelCalls,
    namedCalls,
    customerHttp: /["'`]\/api\/customers(?:\/|["'`?])/.test(text),
    opportunityHttp: /["'`]\/api\/opportunities(?:\/|["'`?])/.test(text),
  };
}

function writeEvidence(name: string, value: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("U043 repository-discovered CRM authority", () => {
  const records = productionFiles().map(scanFile);
  const modelCalls = records.flatMap((record) => record.modelCalls);
  const namedCalls = records.flatMap((record) => record.namedCalls);
  const customerWriters = modelCalls.filter((call) => call.model === "customer" && call.category === "write");
  const opportunityWriters = modelCalls.filter((call) => call.model === "opportunity" && call.category === "write");
  const customerReaders = modelCalls.filter((call) => call.model === "customer" && call.category === "read");
  const coreLoopEdges = records.filter(
    (record) =>
      record.file.endsWith("/core-loop.ts") ||
      record.imports.some((value) => value.endsWith("/core-loop") || value === "./core-loop") ||
      record.exports.some((value) => value.endsWith("/core-loop") || value === "./core-loop"),
  );
  const replayRecords = records.filter(
    (record) =>
      /replay.*generate.*documents/i.test(record.file) ||
      record.imports.some((value) => /replay.*generate.*documents/i.test(value)) ||
      record.exports.some((value) => /replay.*generate.*documents/i.test(value)),
  );

  const graph = {
    schemaVersion: "u043.crm-product-callgraph/v1",
    generatedAt: new Date().toISOString(),
    roots: ROOTS,
    sourceCount: records.length,
    modelCalls,
    namedCalls,
    httpAdapters: records
      .filter((record) => record.customerHttp || record.opportunityHttp)
      .map((record) => ({
        file: record.file,
        customer: record.customerHttp,
        opportunity: record.opportunityHttp,
      })),
  };
  writeEvidence("crm-product-callgraph.json", graph);
  writeEvidence("customer-authority-static.json", {
    schemaVersion: "u043.customer-authority/v1",
    sevenAdapterSubset: SEVEN_CUSTOMER_ADAPTERS,
    customerWriters,
    customerReaders,
    namedCustomerCalls: namedCalls.filter((call) => CUSTOMER_FUNCTIONS.has(call.name)),
  });
  writeEvidence("replay-script-retirement.json", {
    schemaVersion: "u043.replay-retirement/v1",
    present: replayRecords.map((record) => record.file),
    forcedConversionCalls: namedCalls.filter(
      (call) => call.name === "convertOpportunityToProject" && call.hasForceTrue,
    ),
  });
  writeEvidence("core-loop-absence.json", {
    schemaVersion: "u043.core-loop-absence/v1",
    present: coreLoopEdges.map((record) => record.file),
  });

  it("has no stale top-level customer implementation or import/export edge", () => {
    expect(existsSync(join(REPO_ROOT, "packages/business/src/customer-partner.ts"))).toBe(false);
    expect(
      records.flatMap((record) =>
        [...record.imports, ...record.exports]
          .filter((value) =>
            value.includes("packages/business/src/customer-partner") ||
            /^(?:\.\.\/)+customer-partner$/.test(value))
          .map((value) => ({ file: record.file, value })),
      ),
    ).toEqual([]);
  });

  it("keeps Customer writes exclusively in the canonical scoped service", () => {
    expect([...new Set(customerWriters.map((call) => call.file))]).toEqual([
      "packages/business/src/crm/customer-partner.ts",
    ]);
  });

  it("keeps Opportunity writes exclusively in the canonical scoped service", () => {
    expect([...new Set(opportunityWriters.map((call) => call.file))]).toEqual([
      "packages/business/src/crm/opportunity-center.ts",
    ]);
  });

  it("retains exactly the named seven customer adapters and canonicalizes all of them", () => {
    const adapterRecords = SEVEN_CUSTOMER_ADAPTERS.map((file) => {
      const record = records.find((candidate) => candidate.file === file);
      expect(record, file).toBeDefined();
      return record!;
    });
    for (const record of adapterRecords) {
      expect(record.modelCalls.filter((call) => call.model === "customer"), record.file).toEqual([]);
      expect(
        record.namedCalls.some((call) => CUSTOMER_FUNCTIONS.has(call.name)),
        `${record.file} must call the canonical customer service`,
      ).toBe(true);
    }
  });

  it("has no old-arity canonical customer call or caller-selected force conversion", () => {
    const oldArity = namedCalls.filter((call) => {
      const required = CUSTOMER_FUNCTIONS.get(call.name);
      return required !== undefined && call.argumentCount < required;
    });
    expect(oldArity).toEqual([]);
    expect(
      namedCalls.filter((call) => call.name === "convertOpportunityToProject" && call.hasForceTrue),
    ).toEqual([]);
  });

  it("removes replay/apply conversion authority and the core-loop graph", () => {
    expect(replayRecords.map((record) => record.file)).toEqual([]);
    expect(coreLoopEdges.map((record) => record.file)).toEqual([]);
    expect(
      namedCalls.filter(
        (call) =>
          ["convertMailToOpportunity", "processMailApproval"].includes(call.name) ||
          (call.name === "advanceOpportunity" && call.file !== "packages/business/src/crm/opportunity-center.ts"),
      ),
    ).toEqual([]);
  });
});
