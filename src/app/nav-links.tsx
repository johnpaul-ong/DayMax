"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export interface NavGroup {
  label: string;
  subs: Array<{ href: string; label: string }>;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Life",
    subs: [
      { href: "/today", label: "Today" },
      { href: "/day", label: "Month" },
      { href: "/year", label: "Year" },
    ],
  },
  {
    label: "Pursuits",
    subs: [
      { href: "/pursuits", label: "My pursuits" },
      { href: "/pursuits/explore", label: "Explore" },
    ],
  },
  {
    label: "Community",
    subs: [
      { href: "/friends", label: "Friends" },
      { href: "/arena", label: "Arena" },
      { href: "/arena/compare", label: "Side by side" },
      { href: "/search", label: "Search" },
    ],
  },
  {
    label: "Profile",
    subs: [
      { href: "/profile", label: "Profile" },
      { href: "/overview", label: "Analytics" },
      { href: "/metrics", label: "Metrics" },
      { href: "/import", label: "Import" },
      { href: "/export", label: "Export" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

// flat list for the "hide tabs" setting (Settings itself can't be hidden)
export const NAV_TABS = NAV_GROUPS.flatMap((g) => g.subs).map((s) => ({ href: s.href, label: s.label }));

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

function groupFor(pathname: string): NavGroup | null {
  if (pathname === "/lifts") return NAV_GROUPS[1]; // Lifts pursuit lives under Pursuits
  if (pathname.startsWith("/pursuits")) return NAV_GROUPS[1];
  if (pathname.startsWith("/friends") || pathname.startsWith("/arena") || pathname.startsWith("/join") || pathname.startsWith("/search")) return NAV_GROUPS[2];
  for (const g of NAV_GROUPS) {
    if (g.subs.some((s) => pathname === s.href || pathname.startsWith(s.href + "/"))) return g;
  }
  return null;
}

export default function NavLinks() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState<string[]>([]);
  const [requests, setRequests] = useState(0);

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

  // pending friend requests, so they're findable from any page rather than
  // only by stumbling onto the Friends tab
  useEffect(() => {
    import("@/lib/friends")
      .then((f) => f.listFriends())
      .then((fs) => setRequests(fs.filter((x) => x.status === "pending" && x.direction === "incoming").length))
      .catch(() => {});
  }, [pathname]);

  const active = groupFor(pathname);
  const visibleSubs = (g: NavGroup) => g.subs.filter((s) => s.href === "/settings" || !hidden.includes(s.href));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {NAV_GROUPS.filter((g) => visibleSubs(g).length > 0).map((g) => {
          const isActive = active?.label === g.label;
          const first = visibleSubs(g)[0];
          return (
            <Link
              key={g.label}
              href={first.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {g.label}
              {g.label === "Community" && requests > 0 && (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-contrast">{requests}</span>
              )}
            </Link>
          );
        })}
      </div>
      {active && visibleSubs(active).length > 1 && (
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {visibleSubs(active).map((s) => {
            const on = pathname === s.href || pathname.startsWith(s.href + "/");
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  on ? "bg-surface-2 font-semibold text-ink" : "text-faint hover:text-ink"
                }`}
              >
                {s.label}
                {s.href === "/friends" && requests > 0 && (
                  <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-contrast">{requests}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
