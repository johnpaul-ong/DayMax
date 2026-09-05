"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const NAV_TABS = [
  { href: "/day", label: "Month" },
  { href: "/year", label: "Year" },
  { href: "/today", label: "Today" },
  { href: "/lifts", label: "Lifts" },
  { href: "/habits", label: "Habits" },
  { href: "/metrics", label: "Metrics" },
  { href: "/overview", label: "Overview" },
  { href: "/friends", label: "Friends" },
  { href: "/arena", label: "Arena" },
  { href: "/import", label: "Import" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
];

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem("daymax-hidden-tabs");
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveHiddenTabs(hidden: string[]) {
  try {
    localStorage.setItem("daymax-hidden-tabs", JSON.stringify(hidden));
    window.dispatchEvent(new Event("daymax-nav-changed"));
  } catch {}
}

export default function NavLinks() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setHidden(loadHiddenTabs());
    const onChange = () => setHidden(loadHiddenTabs());
    window.addEventListener("daymax-nav-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("daymax-nav-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return (
    <>
      {NAV_TABS.filter((n) => n.href === "/settings" || !hidden.includes(n.href)).map((n) => {
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
