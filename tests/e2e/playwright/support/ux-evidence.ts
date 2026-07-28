import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AxeResult } from "./axe";

type AxeRecord = AxeResult & { cell: string };
type DigestRecord = { cell: string; file: string; sha256: string };

function evidenceDirectory(): string {
  const directory = process.env.ACCEPTANCE_EVIDENCE_DIR?.trim();
  if (!directory) throw new Error("ACCEPTANCE_EVIDENCE_DIR is required for U066 evidence");
  return resolve(directory);
}

function appendUnique<T extends { cell: string }>(file: string, record: T): void {
  const records = (() => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  })();
  if (records.some((entry) => entry.cell === record.cell)) {
    throw new Error(`UX_EVIDENCE_CELL_OVERWRITE:${record.cell}`);
  }
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify([...records, record], null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, file);
}

export function writeCellEvidence(cell: string, screenshot: Buffer, axe: AxeResult): void {
  const root = evidenceDirectory();
  const screenshotDirectory = join(root, "screenshots");
  mkdirSync(screenshotDirectory, { recursive: true });
  const file = `${cell}.png`;
  const screenshotPath = join(screenshotDirectory, file);
  writeFileSync(screenshotPath, screenshot, { flag: "wx" });

  const digest: DigestRecord = {
    cell,
    file,
    sha256: createHash("sha256").update(screenshot).digest("hex"),
  };
  appendUnique(join(root, "snapshot-digests.json"), digest);
  appendUnique<AxeRecord>(join(root, "axe-results.json"), { cell, ...axe });
}
