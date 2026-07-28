import React from "react";

interface Props {
  artifactId: string;
  artifactVersionId: string;
  classification: string;
  content?: Record<string, unknown>;
  redactedFieldPaths?: string[];
  watermark?: { identityLabel: string; companyLabel: string; requestId: string; renderedAt: string };
  accessEventId?: string;
}

export function RestrictedArtifactView({
  artifactId, artifactVersionId, classification, content, redactedFieldPaths, watermark,
}: Props) {
  return (
    <div data-testid="restricted-artifact-view" className="restricted-artifact-view">
      <div className="restricted-badge">🔒 {classification.toUpperCase()} — Restricted</div>
      {watermark && (
        <div className="watermark-overlay" aria-hidden>
          <span>{watermark.identityLabel}</span>
          <span>{watermark.companyLabel}</span>
          <span>{watermark.requestId}</span>
          <span>{watermark.renderedAt}</span>
        </div>
      )}
      <div className="artifact-content">
        <p>Artifact: {artifactId} / Version: {artifactVersionId}</p>
        {redactedFieldPaths && redactedFieldPaths.length > 0 && (
          <p className="redaction-notice">Fields redacted: {redactedFieldPaths.join(", ")}</p>
        )}
        {content && (
          <pre className="artifact-json">{JSON.stringify(content, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
