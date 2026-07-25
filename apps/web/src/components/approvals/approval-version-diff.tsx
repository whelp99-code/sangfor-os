import React from "react";
import type { ApprovalVersionDiff, QuoteLineDiff } from "@sangfor/business";

interface Props {
  versionDiff: ApprovalVersionDiff;
}

export function ApprovalVersionDiff({ versionDiff }: Props) {
  if (!versionDiff.hasDiff) {
    return <div className="no-diff">No version diff — content unchanged</div>;
  }

  if (versionDiff.kind === "quote" && versionDiff.quoteLineDiffs) {
    return (
      <div className="quote-version-diff" data-testid="approval-version-diff">
        <h3>Quote Line Changes</h3>
        <table>
          <thead>
            <tr><th>Line</th><th>Field</th><th>Previous</th><th>New</th></tr>
          </thead>
          <tbody>
            {versionDiff.quoteLineDiffs.map((d: QuoteLineDiff, i: number) => (
              <tr key={i}>
                <td>{d.lineId}</td>
                <td>{d.field}</td>
                <td className="old-val">{d.oldValue}</td>
                <td className="new-val">{d.newValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="generic-version-diff" data-testid="approval-version-diff">
      <p>Content modified from previous version</p>
    </div>
  );
}
