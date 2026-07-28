// packages/business/src/domain-ai/index.ts
// Re-export all domain-ai modules (Phase 5 restructure, P15).
//
// `buildDomainPrompt` is exported by both domain-agent-runtime.ts and
// domain-proposal.ts; domain-agent-runtime's is re-exported by name
// (excluding buildDomainPrompt) to avoid the naming collision, matching
// the pre-move behavior in packages/business/src/index.ts.
export * from "./domain-pipeline";
export * from "./domain-memory";
export {
  type DomainCase,
  type DomainArtifact,
  type DomainGenerator,
  type ColorGateEvaluator,
  type DomainRuntimeDeps,
  type DomainStageResult,
  resolveDomainGenerator,
  runDomainStage,
  runDomainPipeline,
  createStubGenerator,
} from "./domain-agent-runtime";
export * from "./domain-embedding";
export * from "./domain-llm";
export * from "./domain-model-policy";
export * from "./domain-artifact-schema";
export * from "./domain-structured";
export * from "./domain-llm-fallback";
export * from "./domain-dashboard";
export * from "./domain-embedder";
export * from "./domain-default-generator";
export * from "./domain-embedder-openai";
export * from "./domain-persistence";
export * from "./domain-pnl";
export * from "./domain-proposal";
export * from "./color-gate-llm";
export * from "./proposal-promote";
export * from "./proposal-context";
export * from "./artifact-domain-map";
export * from "./color-agent";
export * from "./color-gate";
export * from "./knowledge-search";
export * from "./project-decision";
export * from "./project-hub";
export * from "./rag-context";
export * from "./governed-domain-proposal";
