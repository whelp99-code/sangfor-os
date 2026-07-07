"use client";

import { useEffect, useState } from "react";

type DefaultProject = {
  id: string;
  slug: string;
  name: string;
};

type CacheEntry =
  | { status: "loading" }
  | { status: "loaded"; project: DefaultProject }
  | { status: "error"; error: unknown };

let moduleCache: CacheEntry = { status: "loading" };
let inflight: Promise<void> | null = null;

function fetchDefaultProject(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/projects/default")
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`/api/projects/default returned ${res.status}`);
      }
      const body = (await res.json()) as { project: DefaultProject };
      moduleCache = { status: "loaded", project: body.project };
    })
    .catch((error) => {
      moduleCache = { status: "error", error };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useDefaultProject(): {
  project: DefaultProject | null;
  isLoading: boolean;
  error: unknown;
} {
  const [state, setState] = useState<CacheEntry>(moduleCache);

  useEffect(() => {
    if (moduleCache.status === "loading") {
      fetchDefaultProject().then(() => {
        setState({ ...moduleCache });
      });
    } else {
      setState({ ...moduleCache });
    }
  }, []);

  if (state.status === "loading") return { project: null, isLoading: true, error: null };
  if (state.status === "error") return { project: null, isLoading: false, error: state.error };
  return { project: state.project, isLoading: false, error: null };
}
