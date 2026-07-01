export type NavItem = {
  title: string;
  href: string;
  icon: string;
  roles?: string[];
  group?: string;
};

export const PORTAL_NAV: NavItem[] = [
  // ═══ Business Core ═══
  { title: "내 업무", href: "/my-work", icon: "layout-grid", group: "Business" },
  { title: "Executive Dashboard", href: "/dashboard", icon: "layout-dashboard", group: "Business" },
  { title: "Sales Manager", href: "/sales", icon: "trending-up", group: "Business" },
  { title: "Presales Engineer", href: "/presales", icon: "flask", group: "Business" },
  { title: "Finance Manager", href: "/finance", icon: "trending-up", group: "Business" },
  { title: "Delivery Engineer", href: "/delivery", icon: "truck", group: "Business" },
  { title: "Support Engineer", href: "/support", icon: "headphones", group: "Business" },
  { title: "Color Agents", href: "/agents", icon: "activity", group: "Business" },
  { title: "고객사", href: "/customers", icon: "users", group: "Business" },
  { title: "파트너", href: "/partners", icon: "handshake", group: "Business" },
  { title: "영업기회", href: "/opportunities", icon: "trending-up", group: "Business" },
  { title: "PoC", href: "/poc", icon: "flask", group: "Business" },
  { title: "제안서", href: "/proposals", icon: "file-text", group: "Business" },
  { title: "작업", href: "/tasks", icon: "list-checks", group: "Business" },
  { title: "승인", href: "/approvals", icon: "shield-check", group: "Business", roles: ["owner"] },
  { title: "워크플로우", href: "/commands", icon: "terminal", group: "Business" },

  // ═══ Finance ═══
  { title: "재무 대시보드", href: "/cfo/dashboard", icon: "trending-up", group: "Finance" },
  { title: "매출/미수금", href: "/cfo/invoices", icon: "file-text", group: "Finance" },
  { title: "비용", href: "/cfo/expenses", icon: "list-checks", group: "Finance" },
  { title: "현금흐름", href: "/cfo/cashflows", icon: "activity", group: "Finance" },
  { title: "세금계산서", href: "/cfo/tax-invoices", icon: "file-text", group: "Finance" },
  { title: "부가세", href: "/cfo/vat", icon: "file-text", group: "Finance" },
  { title: "구독", href: "/cfo/subscriptions", icon: "blocks", group: "Finance" },
  { title: "월결산", href: "/cfo/month-close", icon: "list-checks", group: "Finance" },
  { title: "재무 챗봇", href: "/cfo/chat", icon: "terminal", group: "Finance" },

  // ═══ Knowledge & Intelligence ═══
  { title: "Agent Console", href: "/agent-console", icon: "bot", group: "Intelligence" },
  { title: "도메인 파이프라인", href: "/domain-pipeline", icon: "git-branch", group: "Intelligence" },
  { title: "Knowledge Search", href: "/knowledge-search", icon: "search", group: "Intelligence" },
  { title: "지식베이스", href: "/knowledge", icon: "book-open", group: "Intelligence" },
  { title: "Mail Intelligence", href: "/mail-intelligence", icon: "mail", group: "Intelligence" },
  { title: "메일 후보", href: "/development/mail-candidates", icon: "inbox", group: "Intelligence" },

  // ═══ Development ═══
  { title: "개발 센터", href: "/development", icon: "code", group: "Development" },
  { title: "오케스트레이터", href: "/development/orchestrator", icon: "activity", group: "Development" },
  { title: "개선사항", href: "/development/improvements", icon: "blocks", group: "Development" },

  // ═══ System ═══
  { title: "MCP Tools", href: "/tools", icon: "wrench", group: "System" },
  { title: "Operator Console", href: "/operator", icon: "activity", group: "System" },
  { title: "Security", href: "/security", icon: "shield-check", group: "System" },
  { title: "설정", href: "/settings", icon: "settings", group: "System" },
];

// Finance in-page horizontal sub-nav, rendered by <CfoSubnav />. The sidebar
// shows the "재무" cluster; these sub-pages navigate in-place on /cfo pages.
export const CFO_NAV: { title: string; href: string }[] = [
  { title: "재무 대시보드", href: "/cfo/dashboard" },
  { title: "딜별 손익", href: "/cfo/projects" },
  { title: "매출/미수금", href: "/cfo/invoices" },
  { title: "비용", href: "/cfo/expenses" },
  { title: "현금흐름", href: "/cfo/cashflows" },
  { title: "세금계산서", href: "/cfo/tax-invoices" },
  { title: "부가세", href: "/cfo/vat" },
  { title: "구독", href: "/cfo/subscriptions" },
  { title: "월결산", href: "/cfo/month-close" },
  { title: "재무 챗봇", href: "/cfo/chat" },
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
