-- Align existing seeded rows with the decision type consumed by the runtime.
-- If an operator already created the canonical row, preserve it and remove only
-- the unreachable legacy row; otherwise rename the legacy row in place.
UPDATE "autonomy_policies" AS legacy
SET
  "decisionType" = 'autopilot_approve',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE legacy."decisionType" = 'mail_candidate_approve'
  AND NOT EXISTS (
    SELECT 1
    FROM "autonomy_policies" AS canonical
    WHERE canonical."domain" = legacy."domain"
      AND canonical."decisionType" = 'autopilot_approve'
  );

DELETE FROM "autonomy_policies"
WHERE "decisionType" = 'mail_candidate_approve';
