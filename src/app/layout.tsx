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
        <nav className="sticky top-0 z-40 border-b bg-surface">
          <div className="mx-auto flex max-w-6xl items-center gap-0.5 overflow-x-auto px-3 py-2.5">
            <Link href="/" className="mr-4 whitespace-nowrap text-lg font-bold tracking-tight">
              Day<span className="text-accent">Max</span>
            </Link>
            <NavLinks />
            {/* Bell sits after nav links, before ThemeSync -- the
                right-hand corner of the nav bar. Renders nothing when
                signed out. */}
            <div className="ml-auto flex items-center">
              <NotificationsBell />
            </div>
            <ThemeSync />
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
