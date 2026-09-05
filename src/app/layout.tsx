import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import ThemeSwitcher from "./theme-switcher";

export const metadata: Metadata = {
  title: "DayMax",
  description: "Track your day in 15-minute slots and your lifts. Private, invite-only.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/day", label: "Day" },
  { href: "/year", label: "Year" },
  { href: "/today", label: "Today" },
  { href: "/lifts", label: "Lifts" },
  { href: "/overview", label: "Overview" },
  { href: "/import", label: "Import" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // set theme before paint to avoid a flash
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("daymax-theme")||"light";document.documentElement.dataset.theme=t;var a=localStorage.getItem("daymax-accent");if(a){document.documentElement.style.setProperty("--accent",a);document.documentElement.style.setProperty("--accent-hover",a);}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-page text-ink">
        <nav className="sticky top-0 z-40 border-b bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-0.5 overflow-x-auto px-3 py-2.5">
            <Link href="/" className="mr-4 whitespace-nowrap text-lg font-bold tracking-tight">
              Day<span className="text-accent">Max</span>
            </Link>
            {NAV.slice(1).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
            <ThemeSwitcher />
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
