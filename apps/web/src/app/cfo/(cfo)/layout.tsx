import Link from "next/link";

// CFO pages render live data from the api (/api/cfo) and use client-only
// charts; opt out of static prerender for the whole section.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/cfo/dashboard", label: "대시보드" },
  { href: "/cfo/invoices", label: "미수금" },
  { href: "/cfo/expenses", label: "비용" },
  { href: "/cfo/cashflows", label: "자금흐름" },
  { href: "/cfo/vat", label: "부가세" },
  { href: "/cfo/subscriptions", label: "구독" },
  { href: "/cfo/month-close", label: "월 마감" },
  { href: "/cfo/chat", label: "AI 챗봇" },
  { href: "/cfo/settings", label: "연동 설정" },
];

export default function CfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/cfo/dashboard" className="text-lg font-semibold">
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
