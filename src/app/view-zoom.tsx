"use client";

/**
 * Day / Month / Year are one screen at three zoom levels, not three
 * destinations. They used to sit in the nav as peers, which made the app look
 * like it had three separate features for looking at the same 96 slots.
 *
 * Rendered at the top of /today, /day and /year so the relationship is obvious
 * and switching costs one click instead of a trip back to the nav.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const ZOOMS = [
  { href: "/today", label: "Day" },
  { href: "/day", label: "Month" },
  { href: "/year", label: "Year" },
];

export default function ViewZoom() {
  const pathname = usePathname();
  return (
    <div className="mb-3 inline-flex gap-1 rounded-xl bg-surface-2 p-1 text-sm" role="group" aria-label="Zoom">
      {ZOOMS.map((z) => {
        const on = pathname === z.href;
        return (
          <Link
            key={z.href}
            href={z.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg px-3 py-1 transition ${on ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink"}`}
          >
            {z.label}
          </Link>
        );
      })}
    </div>
  );
}
