import { Prisma, prisma } from "@sangfor/db";

export type MailPolicyMemoryType =
  | "internal_company_name"
  | "internal_domain"
  | "known_partner_name"
  | "known_partner_domain"
  | "known_customer_name"
  | "system_sender_domain";

export type MailPolicyLookup = {
  internalCompanyNames: Set<string>;
  internalDomains: Set<string>;
  knownPartnerNames: Set<string>;
  knownPartnerDomains: Set<string>;
  knownCustomerNames: Set<string>;
  systemSenderDomains: Set<string>;
  memories: Array<{
    memoryType: string;
    key: string;
    label: string;
    confidence: number;
    status: string;
  }>;
};

type SeedPolicyMemory = {
  memoryType: MailPolicyMemoryType;
  key: string;
  label: string;
  valueJson: Prisma.InputJsonValue;
  source: string;
  confidence: number;
  status: string;
};

export function normalizePolicyKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사/g, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9가-힣.-]/g, "")
    .trim();
}

function defaultPolicyMemories(): SeedPolicyMemory[] {
  const seeds: SeedPolicyMemory[] = [
    {
      memoryType: "internal_company_name",
      key: "베를로",
      label: "베를로",
      valueJson: { aliases: ["베를로", "(주)베를로", "주식회사 베를로", "BLRO"] },
      source: "seed",
      confidence: 100,
      status: "active",
    },
    {
      memoryType: "internal_company_name",
      key: "blro",
      label: "BLRO",
      valueJson: { aliases: ["BLRO", "blro"] },
      source: "seed",
      confidence: 100,
      status: "active",
    },
    {
      memoryType: "internal_domain",
      key: "blro.co.kr",
      label: "BLRO internal domain",
      valueJson: { domain: "blro.co.kr" },
      source: "seed",
      confidence: 100,
      status: "active",
    },
    {
      memoryType: "internal_company_name",
      key: "sangfor",
      label: "Sangfor product/vendor org",
      valueJson: { aliases: ["Sangfor", "상포", "상포테크놀로지"] },
      source: "seed",
      confidence: 90,
      status: "active",
    },
    {
      memoryType: "internal_domain",
      key: "sangfor.com",
      label: "Sangfor domain",
      valueJson: { domain: "sangfor.com" },
      source: "seed",
      confidence: 90,
      status: "active",
    },
    {
      memoryType: "internal_domain",
      key: "sangfor.co.kr",
      label: "Sangfor Korea domain",
      valueJson: { domain: "sangfor.co.kr" },
      source: "seed",
      confidence: 90,
      status: "active",
    },
    {
      memoryType: "known_partner_name",
      key: "넥시아스",
      label: "넥시아스",
      valueJson: { aliases: ["넥시아스", "Nexias", "nexias"] },
      source: "seed",
      confidence: 95,
      status: "active",
    },
    {
      memoryType: "known_partner_name",
      key: "nexias",
      label: "Nexias",
      valueJson: { aliases: ["Nexias", "nexias"] },
      source: "seed",
      confidence: 95,
      status: "active",
    },
    {
      memoryType: "known_partner_domain",
      key: "nexias.co.kr",
      label: "Nexias partner domain",
      valueJson: { domain: "nexias.co.kr" },
      source: "seed",
      confidence: 95,
      status: "active",
    },
    {
      memoryType: "system_sender_domain",
      key: "bill36524.com",
      label: "Bill36524 billing system",
      valueJson: { domain: "bill36524.com", reason: "billing/system notification" },
      source: "seed",
      confidence: 100,
      status: "active",
    },
    {
      memoryType: "system_sender_domain",
      key: "crew.you",
      label: "Crew marketing sender",
      valueJson: { domain: "crew.you", reason: "marketing/newsletter sender" },
      source: "seed",
      confidence: 90,
      status: "active",
    },
  ];
  return seeds.map((memory) => ({
    ...memory,
    key: normalizePolicyKey(memory.key),
  }));
}

export async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function seedDefaultMailPolicyMemory(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  const seeds = defaultPolicyMemories();
  for (const seed of seeds) {
    await prisma.policyMemory.upsert({
      where: {
        projectId_memoryType_key: {
          projectId,
          memoryType: seed.memoryType,
          key: seed.key,
        },
      },
      update: {
        label: seed.label,
        valueJson: seed.valueJson,
        source: seed.source,
        confidence: seed.confidence,
        status: seed.status,
      },
      create: {
        projectId,
        memoryType: seed.memoryType,
        key: seed.key,
        label: seed.label,
        valueJson: seed.valueJson,
        source: seed.source,
        confidence: seed.confidence,
        status: seed.status,
      },
    });
  }
  return { projectId, seeded: seeds.length };
}

export async function buildMailPolicyLookup(projectSlug = "demo-project"): Promise<MailPolicyLookup> {
  const projectId = await resolveProjectId(projectSlug);
  const rows = await prisma.policyMemory.findMany({
    where: { projectId, status: { in: ["active", "approved"] } },
  });

  const lookup: MailPolicyLookup = {
    internalCompanyNames: new Set(),
    internalDomains: new Set(),
    knownPartnerNames: new Set(),
    knownPartnerDomains: new Set(),
    knownCustomerNames: new Set(),
    systemSenderDomains: new Set(),
    memories: rows.map((row) => ({
      memoryType: row.memoryType,
      key: row.key,
      label: row.label,
      confidence: row.confidence,
      status: row.status,
    })),
  };

  for (const row of rows) {
    const key = normalizePolicyKey(row.key);
    if (row.memoryType === "internal_company_name") lookup.internalCompanyNames.add(key);
    if (row.memoryType === "internal_domain") lookup.internalDomains.add(key);
    if (row.memoryType === "known_partner_name") lookup.knownPartnerNames.add(key);
    if (row.memoryType === "known_partner_domain") lookup.knownPartnerDomains.add(key);
    if (row.memoryType === "known_customer_name") lookup.knownCustomerNames.add(key);
    if (row.memoryType === "system_sender_domain") lookup.systemSenderDomains.add(key);
  }

  return lookup;
}

export function buildStaticMailPolicyLookup(): MailPolicyLookup {
  const lookup: MailPolicyLookup = {
    internalCompanyNames: new Set(),
    internalDomains: new Set(),
    knownPartnerNames: new Set(),
    knownPartnerDomains: new Set(),
    knownCustomerNames: new Set(),
    systemSenderDomains: new Set(),
    memories: [],
  };

  for (const row of defaultPolicyMemories()) {
    lookup.memories.push({
      memoryType: row.memoryType,
      key: row.key,
      label: row.label,
      confidence: row.confidence,
      status: row.status,
    });
    if (row.memoryType === "internal_company_name") lookup.internalCompanyNames.add(row.key);
    if (row.memoryType === "internal_domain") lookup.internalDomains.add(row.key);
    if (row.memoryType === "known_partner_name") lookup.knownPartnerNames.add(row.key);
    if (row.memoryType === "known_partner_domain") lookup.knownPartnerDomains.add(row.key);
    if (row.memoryType === "known_customer_name") lookup.knownCustomerNames.add(row.key);
    if (row.memoryType === "system_sender_domain") lookup.systemSenderDomains.add(row.key);
  }

  return lookup;
}

export async function upsertPolicyMemory(input: {
  projectSlug?: string;
  memoryType: MailPolicyMemoryType;
  key: string;
  label: string;
  valueJson?: Prisma.InputJsonValue;
  source?: string;
  confidence?: number;
  status?: string;
}) {
  const projectId = await resolveProjectId(input.projectSlug ?? "demo-project");
  const key = normalizePolicyKey(input.key);
  return prisma.policyMemory.upsert({
    where: {
      projectId_memoryType_key: {
        projectId,
        memoryType: input.memoryType,
        key,
      },
    },
    update: {
      label: input.label,
      valueJson: input.valueJson ?? { value: input.key },
      source: input.source ?? "human_feedback",
      confidence: input.confidence ?? 80,
      status: input.status ?? "proposed",
    },
    create: {
      projectId,
      memoryType: input.memoryType,
      key,
      label: input.label,
      valueJson: input.valueJson ?? { value: input.key },
      source: input.source ?? "human_feedback",
      confidence: input.confidence ?? 80,
      status: input.status ?? "proposed",
    },
  });
}
