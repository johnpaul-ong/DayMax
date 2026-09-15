"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export interface NavGroup {
  label: string;
  subs: Array<{ href: string; label: string }>;
}

/**
 * Nine destinations, not sixteen.
 *
 * The old nav listed every page as a peer, so Today / Month / Year / Analytics
 * / Metrics read as five separate features when they are views of one dataset,
 * and a first-time user had to hold the whole map in their head to find
 * something they had already seen once. The mobile bar had five tabs and was
 * perfectly legible; this brings the desktop nav back towards that.
 *
 * Nothing was deleted. Month and Year became zoom levels on Today, Side by
 * side became a mode inside Arena, Explore is reachable from My pursuits and
 * Search, and Import / Export / Metrics moved into Settings under "Your data" —
 * every route still resolves, so old links and bookmarks keep working.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Life",
    // one destination: the zoom switcher on the page handles day/month/year
    subs: [{ href: "/today", label: "Today" }],
  },
  {
    label: "Pursuits",
    subs: [
      { href: "/pursuits", label: "My pursuits" },
      { href: "/challenges", label: "Challenges" },
    ],
  },
  {
    label: "Community",
    subs: [
      { href: "/arena", label: "Arena" },
      { href: "/friends", label: "Friends" },
      { href: "/search", label: "Search" },
    ],
  },
  {
    label: "You",
    subs: [
      { href: "/profile", label: "Profile" },
      { href: "/overview", label: "Analytics" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

// flat list for the "hide tabs" setting
export const NAV_TABS = NAV_GROUPS.flatMap((g) => g.subs).map((s) => ({ href: s.href, label: s.label }));

/**
 * Tabs you cannot hide. Settings is the only way to unhide anything, and Today
 * is the only nav route to the day/month/year views now that Month and Year are
 * zoom levels on the page rather than tabs of their own — hiding it would strip
 * three screens out of the app with nothing left pointing at them.
 */
const UNHIDEABLE = ["/settings", "/today"];

export function loadHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem("daymax-hidden-tabs");
    const stored = raw ? (JSON.parse(raw) as string[]) : [];
    // Drop entries for tabs that no longer exist. /day, /year, /arena/compare,
    // /metrics, /import and /export were all hideable tabs once; leaving their
    // stored values in place would mean a preference nobody can see or undo.
    const known = new Set(NAV_TABS.map((t) => t.href));
    return stored.filter((h) => known.has(h) && !UNHIDEABLE.includes(h));
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
  // Routes that no longer appear in the nav still need to light up a group,
  // otherwise landing on /import or /year leaves the whole bar looking inert.
  const startsWithAny = (...ps: string[]) => ps.some((x) => pathname === x || pathname.startsWith(x + "/"));
  if (startsWithAny("/today", "/day", "/year")) return NAV_GROUPS[0];
  if (startsWithAny("/pursuits", "/money", "/challenges", "/lifts", "/habits")) return NAV_GROUPS[1];
  if (startsWithAny("/friends", "/arena", "/join", "/search")) return NAV_GROUPS[2];
  if (startsWithAny("/profile", "/overview", "/settings", "/metrics", "/import", "/export", "/gaps")) return NAV_GROUPS[3];
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
  const visibleSubs = (g: NavGroup) => g.subs.filter((s) => UNHIDEABLE.includes(s.href) || !hidden.includes(s.href));

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
      {/* Life has a single sub, so this row would disappear on /today, /day and
          /year and shunt the whole page up. Reserve the height either way. */}
      <div className="min-h-[26px]">
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
    </div>
  );
}
