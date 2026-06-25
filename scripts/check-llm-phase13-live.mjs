#!/usr/bin/env node
/** Live Phase13 LLM smoke — uses .env MiMo settings. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnvFile(resolve(root, ".env"));
Object.assign(process.env, env);

const {
  buildChatCompletionRequestBody,
  describeOpenAiKeyProfile,
  extractChatCompletionText,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
  getOpenAiApiKey,
} = await import("../packages/automation/src/openai-config.ts");

const { runSkillWithMetadata } = await import(
  "../packages/automation/src/skills/skill-runner.ts"
);

const profile = describeOpenAiKeyProfile();
if (!profile.ok) {
  console.error("FAIL: key profile:", profile.reason);
  process.exit(1);
}

const apiKey = getOpenAiApiKey();
const model = getOpenAiModel();
console.log("=== Phase13 LLM live smoke ===");
console.log("resolved base:", profile.resolvedBaseUrl);
if (profile.note) console.log("note:", profile.note);
console.log("model:", model);

const skill = await runSkillWithMetadata({
  skillKey: "aios-impact-analysis",
  inputSummary: "AIOS v1 post-MiMo integration verification smoke test",
});

console.log(
  JSON.stringify(
    {
      executionMode: skill.executionMode,
      metadataMode: skill.metadata.mode,
      model: skill.metadata.model,
      fallbackReason: skill.metadata.fallbackReason,
      outputLabel: skill.rawOutput.label,
    },
    null,
    2,
  ),
);

if (skill.executionMode !== "llm" || skill.metadata.mode !== "llm") {
  console.error("FAIL: expected live LLM execution");
  process.exit(1);
}

console.log("PASS: Phase13 skill-runner live LLM");
