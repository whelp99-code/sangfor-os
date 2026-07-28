import React from "react";
import { RouteState } from "@/components/ui/route-state";

export default function GlobalNotFound() {
  return (
    <main>
      <RouteState kind="not_found" />
    </main>
  );
}
