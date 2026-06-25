export type NavItem = {
  title: string;
  href: string;
  icon: string;
  /** Roles allowed to see this item. Empty = all roles. */
  roles?: string[];
};

export const PORTAL_NAV: NavItem[] = [
  { title: "대시보드", href: "/dashboard", icon: "layout-dashboard" },
  { title: "Mail Intelligence", href: "/mail-intelligence", icon: "mail" },
  { title: "고객사", href: "/customers", icon: "users" },
  { title: "파트너", href: "/partners", icon: "handshake" },
  { title: "작업", href: "/tasks", icon: "list-checks" },
  { title: "영업기회", href: "/opportunities", icon: "trending-up" },
  { title: "메일 후보", href: "/development/mail-candidates", icon: "inbox" },
  {
    title: "승인",
    href: "/approvals",
    icon: "shield-check",
    roles: ["owner", "admin"],
  },
  { title: "설정", href: "/settings", icon: "settings" },
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
