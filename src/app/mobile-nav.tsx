"use client";

/**
 * Bottom tab bar, phones only.
 *
 * The feedback was "too hard to use on a phone", and the navigation is a large
 * part of why: a two-tier horizontally-scrolling nav at the TOP of the screen
 * means the primary actions sit furthest from your thumb and half of them are
 * off-screen. Five fixed destinations at the bottom is the convention on every
 * phone app for a reason.
 *
 * Hidden at >= sm, where the existing top nav is fine and has more room.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/today", label: "Today", icon: "M4 4h16v16H4z M4 9h16 M9 4v16" },
  { href: "/money", label: "Money", icon: "M12 2v20 M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8 M5 10v10h14V10" },
  { href: "/arena", label: "Arena", icon: "M6 21V9 M12 21V4 M18 21v-7" },
  { href: "/pursuits", label: "Pursuits", icon: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" },
];

export default function MobileNav() {
  const pathname = usePathname();
  // don't cover the sign-in or onboarding screens
  if (["/signin", "/welcome"].some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface sm:hidden"
      // keep clear of the iPhone home indicator
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="flex">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              // 56px tall: comfortably above the 44px minimum touch target
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
