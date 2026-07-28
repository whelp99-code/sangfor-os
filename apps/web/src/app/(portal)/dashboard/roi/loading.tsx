import React from "react";
import { RouteState } from "@/components/ui/route-state";

export default function RoiDashboardLoading() {
  return (
    <main id="main-content" tabIndex={-1}>
      <RouteState kind="loading" />
    </main>
  );
}
