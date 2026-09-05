/**
 * Local calendar dates.
 *
 * NEVER use `new Date().toISOString().slice(0, 10)` for "today" — that is the
 * UTC date. In Sydney (UTC+10/+11) every moment between midnight and ~10am
 * local is still *yesterday* in UTC, so the app would sit on the previous
 * day's log until mid-morning. These helpers read the browser's own calendar.
 */

/** Today's date in the user's own timezone, as YYYY-MM-DD. */
export function localToday(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** This month in the user's own timezone, as YYYY-MM. */
export function localMonth(d: Date = new Date()): string {
  return localToday(d).slice(0, 7);
}

/** The user's IANA timezone name (e.g. "Australia/Sydney"), or null. */
export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
