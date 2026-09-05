import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DayMax",
  description: "Track your day in 15-minute slots and your lifts. Private, invite-only.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/day", label: "Day grid" },
  { href: "/today", label: "Today" },
  { href: "/lifts", label: "Lifts" },
  { href: "/overview", label: "Overview" },
  { href: "/import", label: "Import" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <nav className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-2">
            <span className="mr-3 whitespace-nowrap text-lg font-bold tracking-tight">
              Day<span className="text-blue-600">Max</span>
            </span>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-3 py-6">{children}</main>
      </body>
    </html>
  );
}
