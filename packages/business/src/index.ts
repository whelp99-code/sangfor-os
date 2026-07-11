// packages/business/src/index.ts
// Public API barrel — every domain folder re-exports through its own
// index.ts, aggregated here (Phase 5 restructure, P15). External consumers
// (`@sangfor/business`) see an unchanged export surface.
export * from "./domain-ai/index";
export * from "./crm/index";
export * from "./finance/index";
export * from "./governance/index";
export * from "./orchestration/index";
export * from "./platform/index";
export * from "./mail/index";
export * from "./support/index";
export * from "./infrastructure/index";
export * from "./skills/index";
