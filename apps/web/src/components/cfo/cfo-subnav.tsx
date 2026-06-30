"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CFO_NAV } from "@/lib/portal-config";
import { CFO } from "@/lib/cfo-theme";
import { cn } from "@/lib/utils";

/**
 * Horizontal, text-only finance sub-nav pinned to the top of every /cfo page.
 * The sidebar shows a single "재무" entry; the nine sub-pages live here and
 * navigate in-place on click.
 */
export function CfoSubnav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="재무 메뉴"
      className="sticky top-0 z-10 -mx-6 -mt-6 mb-2 border-b bg-white/85 px-6 backdrop-blur"
      style={{ borderColor: CFO.hairline }}
    >
      <ul className="flex items-center gap-1 overflow-x-auto py-2.5 scrollbar-thin">
        {CFO_NAV.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                  isActive ? "font-semibold" : "font-medium hover:bg-black/[0.04]"
                )}
                style={{ color: isActive ? CFO.ink : CFO.muted }}
              >
                {item.title}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-2.5 h-0.5 rounded-full"
                    style={{ background: CFO.brass }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
