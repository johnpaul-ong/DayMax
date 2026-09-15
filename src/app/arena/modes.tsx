"use client";

/**
 * The Arena has two modes: ranked boards, and everyone's day laid out side by
 * side. They were separate nav items, which made "Side by side" look like a
 * fourth feature rather than a second way of looking at the same contenders —
 * and it was the item nobody could remember the purpose of.
 *
 * Same treatment as the day/month/year zoom: a switcher on the page, so the
 * relationship is visible and the nav gets one item back.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODES = [
  { href: "/arena", label: "Leaderboards" },
  { href: "/arena/compare", label: "Side by side" },
];

export default function ArenaModes() {
  const pathname = usePathname();
  return (
    <div className="mb-3 inline-flex gap-1 rounded-xl bg-surface-2 p-1 text-sm" role="group" aria-label="Arena mode">
      {MODES.map((m) => {
        const on = pathname === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg px-3 py-1 transition ${on ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink"}`}
          >
            {m.label}
          </Link>
        );
      })}
    </div>
  );
}
