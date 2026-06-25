import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/invoices", label: "미수금" },
  { href: "/expenses", label: "비용" },
  { href: "/cashflows", label: "자금흐름" },
  { href: "/vat", label: "부가세" },
  { href: "/subscriptions", label: "구독" },
  { href: "/month-close", label: "월 마감" },
  { href: "/chat", label: "AI 챗봇" },
  { href: "/settings", label: "연동 설정" },
];

export default function CfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-lg font-semibold">
            CFO-AIOS
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-zinc-600 hover:text-zinc-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
