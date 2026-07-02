// packages/business/src/action-validation.ts
import { prisma } from "@sangfor/db";

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  action?: any;
}

/**
 * Validate an action and persist result to DB.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function validateActionWithDb(actionKey: string): Promise<ValidationResult> {
  // 1. Fetch existing action from DB
  const existing = await prisma.action.findUnique({
    where: { key: actionKey }
  });
  
  if (!existing) {
    return { isValid: false, errors: ["Action not found"] };
  }
  
  // 2. Validate (business logic)
  const isValid = existing.status !== 'DISABLED';
  
  // 3. Persist validation result
  await prisma.actionValidationLog.create({
    data: { actionKey, isValid, timestamp: new Date() }
  });
  
  return { isValid, action: existing };
}
