/**
 * Q8 Gate 2: validates a frozen, file-backed census of AI-rejected candidates.
 * It never reads a database, credentials, or mail content.
 */
import { constants, createReadStream, read } from "node:fs";
import { once } from "node:events";
import { open } from "node:fs/promises";
import {
  evaluateMailAiRejectGate,
  invalidMailAiRejectGateReceipt,
} from "../src/mail/mail-ai-reject-gate";

interface CliPaths {
  population: string;
  reviews: string;
}

export const MAIL_AI_REJECT_GATE_MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const MAIL_AI_REJECT_GATE_READ_TIMEOUT_MS = 5_000;

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
  // O_NONBLOCK prevents a swapped FIFO/device path from blocking before fstat can reject it.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error("Input path must resolve to a regular file.");
    }
    stream = createReadStream(path, {
      fd: file.fd,
      autoClose: false,
      highWaterMark: 64 * 1024,
      // FileHandle exclusively owns the descriptor; ReadStream destruction must not close it.
      fs: {
        read,
        close(_fd, callback) {
          callback(null);
        },
      },
    });
    const deadline = setTimeout(
      () => stream.destroy(new Error(`Input read exceeded the ${MAIL_AI_REJECT_GATE_READ_TIMEOUT_MS}ms deadline.`)),
      MAIL_AI_REJECT_GATE_READ_TIMEOUT_MS,
    );
    try {
      for await (const chunk of stream) {
        totalBytes += chunk.length;
        if (totalBytes > MAIL_AI_REJECT_GATE_MAX_INPUT_BYTES) {
          throw new Error(`Input exceeds the ${MAIL_AI_REJECT_GATE_MAX_INPUT_BYTES}-byte limit.`);
        }
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(deadline);
      if (!stream.closed) {
        const closed = once(stream, "close");
        stream.destroy();
        await closed;
      }
    }
  } finally {
    await file.close();
  }
  return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown;
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
