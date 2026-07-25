import React from "react";
import type { OwnerTuple } from "@sangfor/business";

interface Props {
  roleChangeRequestId: string;
  ownershipTransferId?: string;
  transferRequired: boolean;
  itemCount: number;
  tuples: OwnerTuple[];
  previewHash: string;
  previewSchemaVersion: string;
  membershipRevision: number;
  approvalRequestRevision: number;
  successorEligibility: string;
  blockers?: string[];
}

export function OwnershipTransferPanel({
  roleChangeRequestId, ownershipTransferId, transferRequired, itemCount, tuples,
  previewHash, previewSchemaVersion, successorEligibility, blockers,
}: Props) {
  return (
    <section data-testid="ownership-transfer-panel" className="ownership-transfer-panel">
      <h2>Ownership Transfer</h2>
      {transferRequired ? (
        <>
          <div className="transfer-badge transfer-required">Transfer Required</div>
          <p>{itemCount} resource(s) must be transferred before role change.</p>
          <p>Preview: <code>{previewSchemaVersion}</code></p>
          <p>Hash: <code>{previewHash}</code></p>
          <p>Successor eligibility: {successorEligibility}</p>
          {ownershipTransferId && <p>Transfer ID: <code>{ownershipTransferId}</code></p>}
          {blockers && blockers.length > 0 && (
            <ul className="blockers">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          )}
          <table>
            <thead><tr><th>Type</th><th>ID</th><th>Revision</th></tr></thead>
            <tbody>
              {tuples.map((t) => (
                <tr key={`${t.entityType}/${t.entityId}`}>
                  <td>{t.entityType}</td>
                  <td>{t.entityId}</td>
                  <td>{t.ownershipRevision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="transfer-badge transfer-not-required">
          No Transfer Required — zero owned resources
        </div>
      )}
    </section>
  );
}
