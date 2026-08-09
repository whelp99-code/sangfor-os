/**
 * Q8 Gate 2: validates a frozen, file-backed census of AI-rejected candidates.
 * It never reads a database, credentials, or mail content.
 */
import { readFile } from "node:fs/promises";
import {
  evaluateMailAiRejectGate,
  invalidMailAiRejectGateReceipt,
} from "../src/mail/mail-ai-reject-gate";

interface CliPaths {
  population: string;
  reviews: string;
}

function parseCliPaths(args: string[]): CliPaths | undefined {
  if (args.length !== 4) return undefined;
  const paths = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const path = args[index + 1];
    if ((flag !== "--population" && flag !== "--reviews") || !path || paths.has(flag)) return undefined;
    paths.set(flag, path);
  }
  const population = paths.get("--population");
  const reviews = paths.get("--reviews");
  return population && reviews ? { population, reviews } : undefined;
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const paths = parseCliPaths(process.argv.slice(2));
  if (!paths) {
    const result = invalidMailAiRejectGateReceipt("Usage: --population <frozen-population.json> --reviews <reviews.json>");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  try {
    const [population, reviews] = await Promise.all([loadJson(paths.population), loadJson(paths.reviews)]);
    const result = evaluateMailAiRejectGate(population, reviews);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to read or parse the input JSON files.";
    const result = invalidMailAiRejectGateReceipt(detail);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  }
}

void main();
