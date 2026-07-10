// packages/business/src/mail-candidates.ts
//
// Entry point / compatibility shim. The implementation was decomposed
// (Phase 4, god-file split) into packages/business/src/mail/ as four
// dependency-ordered modules:
//   constants.ts            — schemas, keyword lists, static policy lookup
//   classify-rules.ts       — pure policy/keyword classification (no I/O)
//   classify-ai.ts          — AI-assisted classification + revalidation
//   candidates-update.ts    — list/get/approve/reject/convert (DB writes)
//   candidates-generate.ts  — candidate generation pipeline (DB writes)
//
// This file re-exports the public surface so `@sangfor/business` and the
// `@sangfor/business/mail-candidates` subpath keep working unchanged.
export * from "./mail/constants";
export * from "./mail/classify-rules";
export * from "./mail/classify-ai";
export * from "./mail/candidates-update";
export * from "./mail/candidates-generate";

