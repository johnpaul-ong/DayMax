import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import NavLinks from "./nav-links";
import NotificationsBell from "./notifications-bell";
import ThemeSync from "./theme-switcher";
import WelcomeGate from "./welcome-gate";
import CaptureWidgetBoot from "./capture-widget-boot";
import MobileNav from "./mobile-nav";

export const metadata: Metadata = {
  title: { default: "DayMax", template: "%s · DayMax" },
  description: "Track your day in 15-minute slots, your lifts, and whatever else you're pursuing.",
  applicationName: "DayMax",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "DayMax",
    description: "Every day, every 15 minutes.",
    images: ["/og.png"],
    type: "website",
  },
  // iOS treats this as "yes, run me fullscreen from the home screen"
  appleWebApp: { capable: true, title: "DayMax", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // matches --page in both themes so the browser chrome doesn't clash
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
  ],
};

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
        {/*
         * Cottage-theme leaf backdrop. Hidden by default, made
         * visible in globals.css only when data-theme="cottage".
         * Lives here (not in a body::before) because the two body
         * pseudo-elements are already spoken for by the drifting
         * leaves, AND because we need an element with a real
         * background so we can use `mask` -- background-images on
         * the body can't be tinted by a CSS variable, so the old
         * hardcoded moss-green tile was unresponsive to the user's
         * accent choice. This layer paints the accent through a
         * leaf-shaped mask, so pink accent = pink leaves.
         */}
        <div className="cottage-leaves" aria-hidden="true" />
        {/* Nav z-index is DELIBERATELY very high (100). The nav
            creates its own stacking context via sticky + z-index,
            so anything rendered inside it (like the notification
            dropdown) is capped at the nav's page-level z. Nav at
            z-50 meant the dropdown, no matter how high its own z,
            paints at level 50 -- which lost to any page content
            with an explicit stacking context nearby, and the
            dropdown ended up SEE-THROUGH over cards below the
            nav. z-100 keeps the whole nav stacking context above
            every ordinary card, and comfortably above the Capture
            Widget (z-55) so the dropdown always wins.

            Split into two containers on purpose: LEFT half (logo +
            tabs) scrolls horizontally on narrow viewports without
            dragging the bell + theme switcher with it. Bell +
            theme are a shrink-0 sibling of the scroll rail so they
            sit at the right edge no matter what the tabs are
            doing. */}
        <nav className="sticky top-0 z-[100] border-b bg-surface">
          <div className="mx-auto flex max-w-6xl items-center px-3">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-2.5">
              <Link href="/" className="mr-4 whitespace-nowrap text-lg font-bold tracking-tight">
                Day<span className="text-accent">Max</span>
              </Link>
              <NavLinks />
            </div>
            {/* Right-side controls -- always pinned. shrink-0 so a
                narrow viewport doesn't squeeze the bell to zero. */}
            <div className="flex shrink-0 items-center gap-1 py-2.5 pl-2">
              <NotificationsBell />
              <ThemeSync />
            </div>
          </div>
        </nav>
        <WelcomeGate />
        <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:pb-8">{children}</main>
        <CaptureWidgetBoot />
        <MobileNav />
      </body>
    </html>
  );
}
