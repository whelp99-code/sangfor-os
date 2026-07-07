"use client";

import { useDefaultProject } from "@/hooks/use-default-project";

export function ProjectSelector() {
  const { project, isLoading } = useDefaultProject();

  if (isLoading) {
    return (
      <span className="inline-flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
        ...
      </span>
    );
  }

  return (
    <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium">
      {project?.name ?? "프로젝트"}
    </span>
  );
}
