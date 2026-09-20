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

/**
 * Five fixed destinations, matched to the desktop nav's primary groups
 * (Life=/today, Pursuits, Community/Home, Money, You). Today sits in the
 * centre slot and is styled as the primary tap: it is the "log a slot"
 * action, which is the whole reason the app exists. Home used to be centre
 * but it is a read-only surface, so it moves out of the primary slot and
 * lives next to Pursuits.
 */
type Tab = { href: string; label: string; icon: string; primary?: boolean };
const TABS: Tab[] = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8 M5 10v10h14V10" },
  { href: "/pursuits", label: "Pursuits", icon: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" },
  { href: "/today", label: "Today", icon: "M12 5v14 M5 12h14", primary: true },
  { href: "/money", label: "Money", icon: "M12 2v20 M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { href: "/profile", label: "You", icon: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 20a8 8 0 0 1 16 0" },
];

export default function MobileNav() {
  const pathname = usePathname();
  // don't cover the sign-in or onboarding screens
  if (["/signin", "/welcome"].some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 border-t bg-surface sm:hidden"
      // Inline position + zIndex so nothing in globals.css can override
      // them. The user reported the nav "only visible at the bottom of
      // the page" -- symptom of a theme rule beating Tailwind's z-40
      // or an ancestor overriding position. Belt and braces.
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 45,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Primary"
    >
      <div className="flex items-end">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          if (t.primary) {
            // Elevated centre tap: the "log a slot" primary action. Circle
            // sits above the bar so a thumb lands on it without hunting.
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                aria-label={`${t.label} — log a slot`}
                className="flex flex-1 flex-col items-center gap-0.5 pb-2 pt-1 text-[10px] font-semibold text-accent transition"
              >
                <span className="flex h-11 w-11 -translate-y-3 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg ring-4 ring-surface">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-6 w-6" aria-hidden="true">
                    <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="-mt-2">{t.label}</span>
              </Link>
            );
          }
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
