/**
 * Parent categories are shared across all DayMax users so Compare stays fair.
 * Subcategories/labels are personal free text (the part after the number).
 *
 * Buckets drive the productivity ranking. Defaults (owner can change in settings):
 *   productive = Work + Sports
 *   brainrot   = Other + Leisure
 *   other      = everything else
 */

export type Bucket = "productive" | "brainrot" | "other";

export interface Category {
  code: number;
  name: string;
  /** Legacy names seen in the source spreadsheet that map to this category. */
  aliases: string[];
  defaultBucket: Bucket;
  color: string;
}

/**
 * The `color` field is the LIGHT-theme value, and doubles as the SSR
 * fallback and the value baked into `var()` calls below. Runtime colour
 * comes from `--cat-0` .. `--cat-9` defined per-theme in globals.css, so
 * Midnight (neon HUD), Cottage (earthy) and Light each get their own
 * take on the same 10 categories without the day-grid, spiral, year
 * strip and every legend having to know about themes.
 */
export const CATEGORIES: Category[] = [
  { code: 0, name: "Sleep", aliases: ["sleep"], defaultBucket: "other", color: "#94a3b8" },
  { code: 1, name: "Work/School", aliases: ["work", "school", "work/school", "study", "studying"], defaultBucket: "productive", color: "#4338ca" },
  { code: 2, name: "Sports", aliases: ["gym / judo", "gym", "judo"], defaultBucket: "productive", color: "#047857" },
  { code: 3, name: "Social", aliases: ["social"], defaultBucket: "other", color: "#b45309" },
  { code: 4, name: "Travel", aliases: ["travel"], defaultBucket: "other", color: "#0284c7" },
  { code: 5, name: "Misc / Getting Ready", aliases: ["misc", "getting ready", "misc / getting ready"], defaultBucket: "other", color: "#7c3aed" },
  { code: 6, name: "Other", aliases: ["fucking around / other", "fucking around", "other"], defaultBucket: "brainrot", color: "#dc2626" },
  { code: 7, name: "Eat", aliases: ["eat"], defaultBucket: "other", color: "#ea580c" },
  { code: 8, name: "Family", aliases: ["family"], defaultBucket: "other", color: "#db2777" },
  { code: 9, name: "Leisure", aliases: ["leisure"], defaultBucket: "brainrot", color: "#9f1239" },
];

export const CATEGORY_BY_CODE = new Map(CATEGORIES.map((c) => [c.code, c]));

export function categoryName(code: number): string {
  return CATEGORY_BY_CODE.get(code)?.name ?? `Unknown (${code})`;
}

/**
 * A category colour, as a CSS `var()` reference. Every day-grid, spiral,
 * year strip and legend uses this; because it's a CSS custom property
 * (with a static hex fallback for SSR), the whole app repaints when
 * you switch themes without a single component having to know that
 * themes exist.
 *
 * The fallback IS the light theme's value, so first paint before the
 * stylesheet applies is still correct.
 */
export function categoryColor(code: number): string {
  const c = CATEGORY_BY_CODE.get(code);
  if (!c) return "#6b7280";
  return `var(--cat-${code}, ${c.color})`;
}

/**
 * Same colour as a concrete hex, for canvas / measurement / any API
 * that parses colour strings itself. Falls back to the static value
 * on the server or in tests where `document` is absent.
 */
export function resolveCategoryColor(code: number): string {
  const c = CATEGORY_BY_CODE.get(code);
  const fallback = c?.color ?? "#6b7280";
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--cat-${code}`).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export function defaultBuckets(): Record<number, Bucket> {
  const out: Record<number, Bucket> = {};
  for (const c of CATEGORIES) out[c.code] = c.defaultBucket;
  return out;
}

export const SLOTS_PER_DAY = 96;
export const HOURS_PER_SLOT = 0.25;

/** slot index 0..95 -> "HH:MM" */
export function slotToTime(slot: number): string {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" -> slot index 0..95, or null if not a valid 15-min boundary */
export function timeToSlot(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || ![0, 15, 30, 45].includes(min)) return null;
  return h * 4 + min / 15;
}
