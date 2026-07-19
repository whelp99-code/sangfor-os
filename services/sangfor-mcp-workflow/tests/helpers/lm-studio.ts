/**
 * U007 — minimal LM Studio helper (fixture-oriented; no runtime skip).
 */
import type { LLMClient } from '@sangfor/workflow-engine';

/** Always true: release lane uses in-process fixture, never external LM. */
export function shouldRunLmStudioIntegrationTests(): boolean {
  return true;
}

/** Probe fixture client health (no skip path). */
export async function probeLmStudio(client: LLMClient): Promise<boolean> {
  try {
    return (await client.healthCheck()) === true;
  } catch {
    return false;
  }
}
