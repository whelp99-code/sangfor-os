#!/usr/bin/env python3
"""Atomic re-apply of V2 tracked-file edits (thrash-resistant)."""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

def patch(path, anchor, insert_after_anchor, *, label):
    p = ROOT / path
    text = p.read_text()
    if insert_after_anchor in text:
        print(f"  [skip] {label}: already present")
        return
    if anchor not in text:
        sys.exit(f"  [FAIL] {label}: anchor not found in {path}")
    text = text.replace(anchor, anchor + insert_after_anchor, 1)
    p.write_text(text)
    print(f"  [ok]   {label}")

# 1) schema: embedding column inside DomainMemory model (anchor on its unique confidence=80)
schema = ROOT / "packages/db/prisma/schema.prisma"
s = schema.read_text()
if 'embedding  Float[]' not in s:
    dm = s.index('model DomainMemory {')
    # first createdAt after the model start belongs to DomainMemory
    cidx = s.index('  createdAt  DateTime @default(now()) @map("created_at")', dm)
    s = s[:cidx] + '  embedding  Float[]  @default([]) // V2: semantic recall (app-layer cosine)\n' + s[cidx:]
    schema.write_text(s)
    print("  [ok]   schema: DomainMemory.embedding")
else:
    print("  [skip] schema: embedding already present")

# 2) domain-memory.ts: record field
patch("packages/business/src/domain-memory.ts",
      "  status: string;\n  createdAt?: Date;\n}",
      "\n", label="domain-memory record field (noop placeholder)") if False else None
dm_path = ROOT / "packages/business/src/domain-memory.ts"
dm = dm_path.read_text()
if "embedding?: number[]" not in dm:
    dm = dm.replace(
        "  status: string;\n  createdAt?: Date;\n}",
        "  status: string;\n  createdAt?: Date;\n  embedding?: number[];\n}", 1)
    dm = dm.replace(
        '    status: input.status ?? "active",\n  };',
        '    status: input.status ?? "active",\n    ...(input.embedding ? { embedding: input.embedding } : {}),\n  };', 1)
    dm = dm.replace(
        "  status?: string;\n}) {\n  const projectId = await resolveProjectId(input.projectSlug);\n  const data",
        "  status?: string;\n  embedding?: number[];\n}) {\n  const projectId = await resolveProjectId(input.projectSlug);\n  const data", 1)
    dm = dm.replace(
        "    createdAt: row.createdAt,\n  }));",
        "    createdAt: row.createdAt,\n    embedding: (row as { embedding?: number[] }).embedding ?? [],\n  }));", 1)
    dm_path.write_text(dm)
    print("  [ok]   domain-memory.ts: embedding support")
else:
    print("  [skip] domain-memory.ts: embedding already present")

# 3) index.ts: export V2 modules
idx = ROOT / "packages/business/src/index.ts"
it = idx.read_text()
if './domain-agent-runtime' not in it:
    it = it.replace('export * from "./domain-memory";',
                    'export * from "./domain-memory";\nexport * from "./domain-agent-runtime";\nexport * from "./domain-embedding";', 1)
    idx.write_text(it)
    print("  [ok]   index.ts: V2 exports")
else:
    print("  [skip] index.ts: V2 exports already present")

print("DONE")
