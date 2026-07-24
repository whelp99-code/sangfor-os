"use client";

import React, { useState } from "react";
import {
  evaluateSizingRule,
  evaluateCompatibilityRule,
  type SizingRulePayload,
  type CompatibilityRulePayload,
} from "@sangfor/business/catalog-rule-engine";

interface RuleEvaluationPanelProps {
  type: "sizing" | "compatibility";
  configJson: any;
}

export function RuleEvaluationPanel({ type, configJson }: RuleEvaluationPanelProps) {
  const [inputs, setInputs] = useState<{ key: string; value: string }[]>([
    { key: "userCount", value: "50" },
  ]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (index: number, field: "key" | "value", val: string) => {
    const next = [...inputs];
    next[index]![field] = val;
    setInputs(next);
  };

  const handleAddInput = () => {
    setInputs([...inputs, { key: "", value: "" }]);
  };

  const handleRemoveInput = (index: number) => {
    setInputs(inputs.filter((_, i) => i !== index));
  };

  const handleEvaluate = () => {
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const item of inputs) {
        if (!item.key.trim()) continue;
        const num = Number(item.value);
        payload[item.key.trim()] = isNaN(num) ? item.value : num;
      }

      if (type === "sizing") {
        const evalResult = evaluateSizingRule(configJson as SizingRulePayload, payload);
        setResult(evalResult);
      } else {
        const evalResult = evaluateCompatibilityRule(configJson as CompatibilityRulePayload, payload);
        setResult(evalResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    }
  };

  return (
    <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-4">
      <h3 className="text-sm font-semibold text-slate-200">Rule Evaluation Simulator</h3>

      <div className="space-y-2">
        <label className="text-xs text-slate-400">Simulation Inputs</label>
        {inputs.map((item, idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="Key (e.g. userCount)"
              value={item.key}
              onChange={(e) => handleInputChange(idx, "key", e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded"
            />
            <input
              type="text"
              placeholder="Value"
              value={item.value}
              onChange={(e) => handleInputChange(idx, "value", e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded"
            />
            <button
              type="button"
              onClick={() => handleRemoveInput(idx)}
              className="px-2 py-1 text-xs bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddInput}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          + Add Input Parameter
        </button>
      </div>

      <button
        type="button"
        onClick={handleEvaluate}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded"
      >
        Evaluate Rule
      </button>

      {error && (
        <div className="p-3 bg-red-950 border border-red-800 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="p-3 bg-slate-950 border border-slate-800 rounded space-y-2">
          <div className="text-xs font-mono text-emerald-400">Evaluation Success</div>
          <pre className="text-xs font-mono text-slate-300 overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
