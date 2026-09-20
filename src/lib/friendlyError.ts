/**
 * "This app can't reach that yet" -- one voice, no filenames, no phase labels.
 *
 * The message a real user should see when a backend piece is missing is NEVER
 * "run migration 0031". This module centralises the wording so every page
 * catches the same failure the same way. Log the raw error for you, show
 * something civil to the user.
 */

export function friendlyBackendError(e: unknown, feature: string): string {
  const raw = String((e as any)?.message ?? e ?? "").toLowerCase();
  // schema/RPC not found -> ask the owner to update. Real users hitting this
  // is an operator problem, not a user problem, and the copy should say so.
  if (raw.includes("does not exist") || raw.includes("schema cache") || raw.includes("could not find")) {
    return `${feature} is temporarily unavailable while we finish rolling out an update. Try again in a minute; if it sticks around, let us know.`;
  }
  if (raw.includes("network") || raw.includes("fetch failed") || raw.includes("timeout")) {
    return `Couldn't reach the server. Check your connection and try again.`;
  }
  // console.error keeps the raw stack for debugging while the user sees prose
  try { console.error(feature, e); } catch {}
  return `Something went wrong loading ${feature}. Try refreshing.`;
}
