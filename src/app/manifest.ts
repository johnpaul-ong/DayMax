import type { MetadataRoute } from "next";

/**
 * Makes DayMax installable on a phone home screen.
 *
 * This matters more than a manifest usually does: Quick Capture only prompts
 * while the app is open, so if DayMax lives in a browser tab nobody ever
 * returns to, the feature doesn't fire. On the home screen it's a real app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DayMax",
    short_name: "DayMax",
    description: "Track your day in 15-minute slots, your lifts, and whatever else you're pursuing.",
    start_url: "/today",         // straight to logging, not the dashboard
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf9f6",
    theme_color: "#faf9f6",
    categories: ["productivity", "lifestyle", "health"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Log today", short_name: "Today", url: "/today" },
      { name: "The Arena", short_name: "Arena", url: "/arena" },
    ],
  };
}
