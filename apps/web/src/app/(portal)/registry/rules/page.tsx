"use client";

import React, { useState } from "react";
import { RuleWorkspace } from "@/components/catalog/rule-workspace";

export default function CatalogRulesPage() {
  const [activeTab, setActiveTab] = useState<"sizing" | "compatibility">("sizing");

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Catalog Rule Engine & Sizing Registry</h1>
          <p className="text-sm text-slate-400">
            Declarative V1 Rule Evaluation, Action-Bound Approval Publishing & CAS Active Versioning
          </p>
        </div>
      </div>

      <div className="flex border-b border-slate-800 space-x-6">
        <button
          onClick={() => setActiveTab("sizing")}
          className={`pb-3 text-sm font-medium border-b-2 transition ${
            activeTab === "sizing"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Sizing Templates
        </button>
        <button
          onClick={() => setActiveTab("compatibility")}
          className={`pb-3 text-sm font-medium border-b-2 transition ${
            activeTab === "compatibility"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Compatibility Rules
        </button>
      </div>

      <RuleWorkspace key={activeTab} type={activeTab} />
    </div>
  );
}
