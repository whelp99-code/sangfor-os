import { prisma } from "@sangfor/db";
import {
  validateAction,
  type ActionValidationResult,
} from "./action-connector-runtime";

/**
 * Validate an action against connector registry status.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function validateActionWithDb(
  actionKey: string,
): Promise<ActionValidationResult> {
  const decodedKey = decodeURIComponent(actionKey);

  let registryStatusByConnector: Record<string, string | null> = {};
  try {
    const rows = await prisma.connectorRegistry.findMany({
      select: { connectorKey: true, status: true },
    });
    registryStatusByConnector = Object.fromEntries(
      rows.map((row) => [row.connectorKey, row.status]),
    );
  } catch {
    registryStatusByConnector = {};
  }

  return validateAction(decodedKey, { registryStatusByConnector });
}
