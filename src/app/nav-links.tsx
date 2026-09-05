"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/day", label: "Month" },
  { href: "/year", label: "Year" },
  { href: "/today", label: "Today" },
  { href: "/lifts", label: "Lifts" },
  { href: "/metrics", label: "Metrics" },
  { href: "/overview", label: "Overview" },
  { href: "/import", label: "Import" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((n) => {
        const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/"));
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
