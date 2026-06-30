export type NavItem = {
  title: string;
  href: string;
  icon: string;
  roles?: string[];
  group?: string;
  tier?: "primary" | "more" | "system";
};

export const PORTAL_NAV: NavItem[] = [
  // ═══ 홈 ═══
  { title: "홈", href: "/home", icon: "home", group: "홈", tier: "primary" },
  { title: "Executive 대시보드", href: "/dashboard", icon: "layout-dashboard", group: "홈", tier: "more" },

  // ═══ CRM ═══
  { title: "딜", href: "/deals", icon: "trending-up", group: "CRM", tier: "primary" },
  { title: "회사", href: "/customers", icon: "building", group: "CRM", tier: "primary" },
  { title: "연락처", href: "/contacts", icon: "contact", group: "CRM", tier: "primary" },
  { title: "파트너", href: "/partners", icon: "handshake", group: "CRM", tier: "more" },
  { title: "영업", href: "/sales", icon: "trending-up", group: "CRM", tier: "more" },
  { title: "프리세일즈", href: "/presales", icon: "flask", group: "CRM", tier: "more" },
  { title: "승인", href: "/approvals", icon: "shield-check", group: "CRM", roles: ["owner"], tier: "more" },

  // ═══ 프로젝트 ═══
  { title: "프로젝트", href: "/projects", icon: "folder-kanban", group: "프로젝트", tier: "more" },
  { title: "작업", href: "/tasks", icon: "list-checks", group: "프로젝트", tier: "more" },
  { title: "PoC", href: "/poc", icon: "flask", group: "프로젝트", tier: "more" },
  { title: "제안서", href: "/proposals", icon: "file-text", group: "프로젝트", tier: "more" },
  { title: "구축", href: "/delivery", icon: "truck", group: "프로젝트", tier: "more" },
  { title: "지원", href: "/support", icon: "headphones", group: "프로젝트", tier: "more" },

  // ═══ 재무 ═══
  { title: "재무 대시보드", href: "/cfo/dashboard", icon: "dollar-sign", group: "재무", tier: "more" },
  { title: "매출/미수금", href: "/cfo/invoices", icon: "file-text", group: "재무", tier: "more" },
  { title: "비용", href: "/cfo/expenses", icon: "list-checks", group: "재무", tier: "more" },
  { title: "현금흐름", href: "/cfo/cashflows", icon: "activity", group: "재무", tier: "more" },
  { title: "세금계산서", href: "/cfo/tax-invoices", icon: "file-text", group: "재무", tier: "more" },
  { title: "부가세", href: "/cfo/vat", icon: "file-text", group: "재무", tier: "more" },
  { title: "구독", href: "/cfo/subscriptions", icon: "blocks", group: "재무", tier: "more" },
  { title: "월결산", href: "/cfo/month-close", icon: "list-checks", group: "재무", tier: "more" },
  { title: "재무 챗봇", href: "/cfo/chat", icon: "terminal", group: "재무", tier: "more" },

  // ═══ 지식 ═══
  { title: "지식베이스", href: "/knowledge", icon: "book-open", group: "지식", tier: "more" },
  { title: "Knowledge Search", href: "/knowledge-search", icon: "search", group: "지식", tier: "more" },
  { title: "Mail Intelligence", href: "/mail-intelligence", icon: "mail", group: "지식", tier: "more" },
  { title: "도메인 파이프라인", href: "/domain-pipeline", icon: "activity", group: "지식", tier: "more" },
  { title: "Agent Console", href: "/agent-console", icon: "bot", group: "지식", tier: "more" },
  { title: "메일 후보", href: "/development/mail-candidates", icon: "inbox", group: "지식", tier: "more" },

  // ═══ 시스템 ═══
  { title: "Color Agents", href: "/agents", icon: "palette", group: "시스템", tier: "system" },
  { title: "워크플로우", href: "/commands", icon: "terminal", group: "시스템", tier: "system" },
  { title: "개발 센터", href: "/development", icon: "code", group: "시스템", tier: "system" },
  { title: "오케스트레이터", href: "/development/orchestrator", icon: "activity", group: "시스템", tier: "system" },
  { title: "개선사항", href: "/development/improvements", icon: "blocks", group: "시스템", tier: "system" },
  { title: "MCP Tools", href: "/tools", icon: "wrench", group: "시스템", tier: "system" },
  { title: "Operator Console", href: "/operator", icon: "activity", group: "시스템", tier: "system" },
  { title: "Security", href: "/security", icon: "shield-check", group: "시스템", tier: "system" },
  { title: "설정", href: "/settings", icon: "settings", group: "시스템", tier: "system" },
];

export type MockProject = {
  id: string;
  slug: string;
  name: string;
};

export const MOCK_PROJECTS: MockProject[] = [
  { id: "demo", slug: "demo-project", name: "Demo Project" },
  { id: "ops", slug: "ops-portal", name: "Ops Portal" },
];

export const MOCK_USER = {
  name: "Portal Operator",
  email: "operator@ai-portal.local",
  role: "owner" as const,
};
