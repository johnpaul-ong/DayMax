/**
 * DayMax service worker — push notifications only.
 *
 * Deliberately NOT a caching/offline worker. Offline support for a data-heavy
 * app needs a real sync strategy, and a half-built cache that serves stale
 * leaderboards is worse than no cache. This file does one job.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "DayMax", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "DayMax";
  const options = {
    body: data.body || "What are you doing right now?",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    // one prompt on screen at a time — replacing is better than stacking six
    tag: data.tag || "daymax-capture",
    renotify: true,
    data: { url: data.url || "/today" },
    actions: [{ action: "log", title: "Log it" }],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today";
  event.waitUntil(
    // focus an existing tab rather than piling up new ones
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// take over immediately on update, so a fixed worker doesn't wait a day
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
