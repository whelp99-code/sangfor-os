import React from "react";
import Link from "next/link";

interface Props {
  entityType?: string;
  count?: number;
}

export function ArchiveDiscoveryLink({ entityType, count = 0 }: Props) {
  const href = entityType ? `/settings/archive?entityType=${entityType}` : "/settings/archive";
  return (
    <Link href={href} className="archive-discovery-link" data-testid="archive-discovery-link">
      보관함 · {count}건
    </Link>
  );
}
