import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { prisma } from "@sangfor/db";
import { z } from "zod";

import {
  buildGroundTruthReclassificationPlan,
  parseMailGroundTruthManifest,
} from "../src/mail/mail-ground-truth";
import { buildGroundTruthImportPlan } from "../src/mail/mail-ground-truth-import-plan";
import { dryRunMailGroundTruthReclassification } from "../src/mail/mail-ground-truth-store";

const DEFAULT_MANIFEST =
  "../../docs/05_DATA_AI/BLRO_Mail_Classification_Ground_Truth_2026-08-12.json";

const candidateSchema = z.object({
  id: z.string().min(1),
  candidateType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  sourceSender: z.string().nullable().optional(),
});

const candidateFileSchema = z.union([
  z.array(candidateSchema),
  z.object({ candidates: z.array(candidateSchema) }).transform(({ candidates }) => candidates),
]);

type Options = {
  readonly candidatesPath?: string;
  readonly manifestPath: string;
  readonly projectId?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @sangfor/business mail-ground-truth:dry-run -- --project-id <id>",
    "  pnpm --filter @sangfor/business mail-ground-truth:dry-run -- --candidates <json>",
    "",
    "Options:",
    `  --manifest <json>    Manifest path (default: ${DEFAULT_MANIFEST})`,
    "  --project-id <id>    Read proposed candidates for one project from the database",
    "  --candidates <json>  Read candidates from JSON; use - for stdin",
    "  --help               Show this help",
    "",
    "This command never writes to the database.",
  ].join("\n");
}

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: readonly string[]): Options {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const candidatesPath = argument(normalizedArgs, "--candidates");
  const projectId = argument(normalizedArgs, "--project-id");
  if (Boolean(candidatesPath) === Boolean(projectId)) {
    throw new TypeError("provide exactly one of --project-id or --candidates");
  }
  return {
    candidatesPath,
    manifestPath: argument(normalizedArgs, "--manifest") ?? DEFAULT_MANIFEST,
    projectId,
  };
}

async function readJson(path: string): Promise<unknown> {
  const content =
    path === "-"
      ? await readFile("/dev/stdin", "utf8")
      : await readFile(resolve(process.cwd(), path), "utf8");
  return JSON.parse(content);
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = parseMailGroundTruthManifest(await readJson(options.manifestPath));
  if (options.candidatesPath) {
    const candidates = candidateFileSchema.parse(await readJson(options.candidatesPath));
    const plan = buildGroundTruthReclassificationPlan(candidates, manifest);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...plan,
          scanned: candidates.length,
          importPlan: buildGroundTruthImportPlan(manifest, []),
          writesPerformed: 0,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const report = await dryRunMailGroundTruthReclassification(manifest, {
    projectId: options.projectId!,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
