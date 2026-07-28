"use client";

import React, { useState } from "react";
import { RuleWorkspace } from "@/components/catalog/rule-workspace";

export default function CatalogRulesPage() {
  const [activeTab, setActiveTab] = useState<"sizing" | "compatibility">("sizing");

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 py-5 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Catalog Rule Engine & Sizing Registry</h1>
          <p className="text-sm text-muted-foreground">
            Declarative V1 Rule Evaluation, Action-Bound Approval Publishing & CAS Active Versioning
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 border-b border-border">
        <button
          onClick={() => setActiveTab("sizing")}
          className={`pb-3 text-sm font-medium border-b-2 transition ${
            activeTab === "sizing"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Sizing Templates
        </button>
        <button
          onClick={() => setActiveTab("compatibility")}
          className={`pb-3 text-sm font-medium border-b-2 transition ${
            activeTab === "compatibility"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Compatibility Rules
        </button>
      </div>

      <RuleWorkspace key={activeTab} type={activeTab} />
    </div>
  );
}
