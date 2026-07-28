/**
 * U043 fail-closed replacement for the legacy unauthenticated revalidation batch.
 *
 * Candidate revalidation now requires a verified session-derived AuthContext, an expected
 * candidate version, and a bounded idempotency key. A local batch process cannot derive those
 * authority facts, so it emits a machine-readable review receipt and performs no database read
 * or mutation.
 */
const receipt = {
  schemaVersion: "sangfor.mail_candidate.revalidation_handoff/v1",
  status: "review_required",
  reason: "authenticated_context_and_candidate_version_required",
  authenticatedApiPath: "/api/mail-candidates/{id}",
  method: "PATCH",
  requiredAction: "revalidate",
  requiredHeaders: ["Idempotency-Key", "session"],
  requiredBodyFields: ["action", "expectedUpdatedAt"],
};

process.stdout.write(`${JSON.stringify(receipt)}\n`);
