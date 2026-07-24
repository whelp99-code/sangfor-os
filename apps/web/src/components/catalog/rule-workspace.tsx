"use client";

import React, { useState } from "react";
import { RuleEvaluationPanel } from "./rule-evaluation-panel";

interface RuleWorkspaceProps {
  type: "sizing" | "compatibility";
  initialRule?: any;
  onSave?: () => void;
}

export function RuleWorkspace({ type, initialRule, onSave }: RuleWorkspaceProps) {
  const [productFamilyId, setProductFamilyId] = useState(initialRule?.productFamilyId || "");
  const [key, setKey] = useState(initialRule?.templateKey || initialRule?.ruleKey || "");
  const [name, setName] = useState(initialRule?.name || "");
  const [configStr, setConfigStr] = useState(
    JSON.stringify(
      initialRule?.configJson || initialRule?.ruleJson || {
        version: "v1",
        rules: [],
      },
      null,
      2
    )
  );

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedConfig = React.useMemo(() => {
    try {
      return JSON.parse(configStr);
    } catch {
      return null;
    }
  }, [configStr]);

  const handleSaveDraft = async () => {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      if (!parsedConfig) {
        throw new Error("Invalid JSON configuration");
      }
      const res = await fetch("/api/catalog/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          productFamilyId,
          key,
          name,
          configJson: parsedConfig,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save rule");

      setMsg("Draft rule saved successfully!");
      if (onSave) onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-950 text-slate-100 rounded-xl border border-slate-800">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider">
            {type} Rule Workspace
          </h2>
          <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-amber-950 text-amber-300 border border-amber-800">
            DRAFT
          </span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Product Family ID
            </label>
            <input
              type="text"
              value={productFamilyId}
              onChange={(e) => setProductFamilyId(e.target.value)}
              placeholder="e.g. fam-hci-v6"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Rule Key Identifier
            </label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. SIZING_V1"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Rule Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard HCI Sizing Rule"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              JSON Rule Definition (V1 Sandbox)
            </label>
            <textarea
              rows={12}
              value={configStr}
              onChange={(e) => setConfigStr(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            {!parsedConfig && (
              <p className="mt-1 text-xs text-red-400">Invalid JSON syntax</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving || !parsedConfig}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded transition"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
          </div>

          {msg && <p className="text-xs text-emerald-400">{msg}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>

      <div>
        <RuleEvaluationPanel type={type} configJson={parsedConfig || {}} />
      </div>
    </div>
  );
}
