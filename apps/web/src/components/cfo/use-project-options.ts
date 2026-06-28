"use client";

import { useEffect, useState } from "react";

/** Fetches finance projects as select options for CFO edit forms. */
export function useProjectOptions() {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "(미지정)" },
  ]);
  useEffect(() => {
    fetch("/api/finance/projects?limit=500")
      .then((r) => r.json())
      .then((rows: { id: string; name: string }[]) =>
        setOptions([{ value: "", label: "(미지정)" }, ...rows.map((p) => ({ value: p.id, label: p.name }))]),
      )
      .catch(() => {});
  }, []);
  return options;
}
