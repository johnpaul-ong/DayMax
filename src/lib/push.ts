"use client";

/**
 * Web Push subscription plumbing.
 *
 * The important iOS caveat, since it determines whether any of this works:
 * Safari only allows push for a PWA that has been ADDED TO THE HOME SCREEN.
 * In a normal Safari tab, `Notification.requestPermission` doesn't exist and
 * `PushManager` is absent. So on iPhone the flow is necessarily:
 *   Share -> Add to Home Screen -> open from the icon -> then enable.
 * `pushSupport()` reports exactly which of those conditions is failing, so the
 * UI can say something useful instead of "not supported".
 */

import { createClient } from "@/lib/supabase/client";

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "needs-install" | "insecure" };

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  // push requires https (localhost counts)
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // on iOS this is almost always "you're in a tab, not the installed app"
    return { ok: false, reason: isIOS && !standalone ? "needs-install" : "unsupported" };
  }
  if (isIOS && !standalone) return { ok: false, reason: "needs-install" };
  return { ok: true };
}

/**
 * VAPID keys travel as base64url; the browser wants raw bytes.
 * Returns an ArrayBuffer rather than a Uint8Array because TS types
 * applicationServerKey as BufferSource over a plain ArrayBuffer, and a
 * Uint8Array's backing store is ArrayBufferLike (possibly SharedArrayBuffer).
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/**
 * Ask permission, subscribe, and store the subscription. Returns a plain-English
 * failure rather than throwing, because every step here can fail for boring
 * reasons the user needs to be told about.
 */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  const support = pushSupport();
  if (!support.ok) {
    return {
      ok: false,
      message:
        support.reason === "needs-install"
          ? "On iPhone, add DayMax to your home screen first (Share → Add to Home Screen), then open it from there and try again."
          : support.reason === "insecure"
          ? "Push needs a secure (https) connection."
          : "This browser doesn't support push notifications.",
    };
  }

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, message: "Push isn't configured on this deployment (missing VAPID key)." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "Notifications are blocked. Turn them on in your browser or OS settings." };
  }

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, message: "Couldn't start the service worker." };
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true, // required by Chrome, and honest: every push shows something
    applicationServerKey: urlBase64ToBuffer(key),
  });

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, message: "The browser returned an incomplete subscription." };
  }

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Sign in first." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: auth.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      failures: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, message: error.message };

  await supabase.from("profiles").update({ push_enabled: true }).eq("id", auth.user.id);
  return { ok: true, message: "Push is on. You'll get a nudge for slots you forget." };
}

export async function disablePush(): Promise<void> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    // the local unsubscribe failing shouldn't stop us turning the flag off
  }
  if (auth.user) await supabase.from("profiles").update({ push_enabled: false }).eq("id", auth.user.id);
}

export interface PushPrefs {
  enabled: boolean;
  quietFrom: number;
  quietTo: number;
  minGapMin: number;
}

export async function fetchPushPrefs(): Promise<PushPrefs> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("push_enabled, push_quiet_from, push_quiet_to, push_min_gap_min")
    .eq("id", auth.user.id)
    .single();
  if (error) throw error;
  return {
    enabled: !!data?.push_enabled,
    quietFrom: data?.push_quiet_from ?? 22,
    quietTo: data?.push_quiet_to ?? 7,
    minGapMin: data?.push_min_gap_min ?? 15,
  };
}

export async function savePushPrefs(p: Partial<PushPrefs>): Promise<void> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const row: Record<string, unknown> = {};
  if (p.enabled !== undefined) row.push_enabled = p.enabled;
  if (p.quietFrom !== undefined) row.push_quiet_from = p.quietFrom;
  if (p.quietTo !== undefined) row.push_quiet_to = p.quietTo;
  if (p.minGapMin !== undefined) row.push_min_gap_min = p.minGapMin;
  const { error } = await supabase.from("profiles").update(row).eq("id", auth.user.id);
  if (error) throw error;
}
