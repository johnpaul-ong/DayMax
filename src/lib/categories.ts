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

export const CATEGORIES: Category[] = [
  { code: 0, name: "Sleep", aliases: ["sleep"], defaultBucket: "other", color: "#94a3b8" },
  { code: 1, name: "Work", aliases: ["work"], defaultBucket: "productive", color: "#2563eb" },
  { code: 2, name: "Sports", aliases: ["gym / judo", "gym", "judo"], defaultBucket: "productive", color: "#16a34a" },
  { code: 3, name: "Social", aliases: ["social"], defaultBucket: "other", color: "#f59e0b" },
  { code: 4, name: "Travel", aliases: ["travel"], defaultBucket: "other", color: "#0ea5e9" },
  { code: 5, name: "Misc / Getting Ready", aliases: ["misc", "getting ready", "misc / getting ready"], defaultBucket: "other", color: "#a78bfa" },
  { code: 6, name: "Other", aliases: ["fucking around / other", "fucking around", "other"], defaultBucket: "brainrot", color: "#ef4444" },
  { code: 7, name: "Eat", aliases: ["eat"], defaultBucket: "other", color: "#f97316" },
  { code: 8, name: "Family", aliases: ["family"], defaultBucket: "other", color: "#ec4899" },
  { code: 9, name: "Leisure", aliases: ["leisure"], defaultBucket: "brainrot", color: "#dc2626" },
];

export const CATEGORY_BY_CODE = new Map(CATEGORIES.map((c) => [c.code, c]));

export function categoryName(code: number): string {
  return CATEGORY_BY_CODE.get(code)?.name ?? `Unknown (${code})`;
}

export function categoryColor(code: number): string {
  return CATEGORY_BY_CODE.get(code)?.color ?? "#6b7280";
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
