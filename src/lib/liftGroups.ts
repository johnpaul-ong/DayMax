/**
 * Grouping free-text exercise names into things worth charting together.
 *
 * Exercise is a free text field, so the same movement arrives as "Bench",
 * "Bench Press", "BP", "Chest Press". One line per spelling is three lines
 * that should be one, and no line for the thing people actually track — the
 * powerlifting total.
 *
 * Matching is deliberately conservative: a name has to contain a known root,
 * and anything ambiguous is left out rather than quietly folded into the wrong
 * lift. A wrong total is worse than a missing one.
 */

export type BigLift = "squat" | "deadlift" | "bench";

export const BIG_THREE: Array<{ key: BigLift; label: string; color: string }> = [
  { key: "squat", label: "Squat", color: "#4f6ef7" },
  { key: "deadlift", label: "Deadlift", color: "#dc2626" },
  { key: "bench", label: "Bench", color: "#16a34a" },
];

/**
 * Which of the big three is this, if any?
 *
 * Order matters. "Romanian deadlift" and "deficit deadlift" are deadlifts;
 * "bench pull" is not a bench press, so "pull" is checked first and wins.
 */
export function classifyLift(raw: string): BigLift | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;

  // accessory work that would otherwise be caught by a root below
  const EXCLUDE = ["calf", "leg press", "leg curl", "leg extension", "hack", "pull up", "pull-up", "pullup", "bench pull", "chest fly", "chest flies"];
  if (EXCLUDE.some((x) => s.includes(x))) return null;

  if (/(^|\b)(squat|squats|bs|fs)(\b|$)/.test(s) || s.includes("squat")) return "squat";
  if (s.includes("deadlift") || s.includes("dead lift") || /(^|\b)(deads?|dl|rdl|sldl)(\b|$)/.test(s)) return "deadlift";
  if (s.includes("bench") || s.includes("chest press") || /(^|\b)(bp)(\b|$)/.test(s)) return "bench";
  return null;
}

export interface LiftLike {
  date: string;
  exercise: string;
  weightKg: number | null;
}

export interface BigThreePoint {
  date: string;
  squat: number | null;
  deadlift: number | null;
  bench: number | null;
  /** Only present once all three have a best — a total of two lifts is not a total. */
  total: number | null;
}

/**
 * Best weight per lift per day, carried forward, plus the running total.
 *
 * Carry-forward matters: you rarely squat, deadlift and bench on the same day,
 * so a strict per-day total would be null almost always. Each lift holds its
 * last known best until it is beaten, which is how a total is normally quoted.
 */
export function bigThreeSeries(rows: LiftLike[]): BigThreePoint[] {
  const byDate = new Map<string, Partial<Record<BigLift, number>>>();
  for (const r of rows) {
    if (r.weightKg == null) continue;
    const k = classifyLift(r.exercise);
    if (!k) continue;
    const day = byDate.get(r.date) ?? {};
    day[k] = Math.max(day[k] ?? 0, Number(r.weightKg));
    byDate.set(r.date, day);
  }

  const best: Partial<Record<BigLift, number>> = {};
  const out: BigThreePoint[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!;
    for (const k of ["squat", "deadlift", "bench"] as BigLift[]) {
      if (day[k] != null) best[k] = Math.max(best[k] ?? 0, day[k]!);
    }
    const haveAll = best.squat != null && best.deadlift != null && best.bench != null;
    out.push({
      date,
      squat: best.squat ?? null,
      deadlift: best.deadlift ?? null,
      bench: best.bench ?? null,
      total: haveAll ? best.squat! + best.deadlift! + best.bench! : null,
    });
  }
  return out;
}

export interface BigThreeSummary {
  squat: number | null;
  deadlift: number | null;
  bench: number | null;
  total: number | null;
  /** How many of the three you have ever logged. */
  covered: number;
  /** Total divided by bodyweight — the number that survives a bulk or a cut. */
  relative: number | null;
}

export function bigThreeSummary(rows: LiftLike[], bodyweightKg?: number | null): BigThreeSummary {
  const s = bigThreeSeries(rows);
  const last = s[s.length - 1];
  const squat = last?.squat ?? null;
  const deadlift = last?.deadlift ?? null;
  const bench = last?.bench ?? null;
  const total = last?.total ?? null;
  return {
    squat,
    deadlift,
    bench,
    total,
    covered: [squat, deadlift, bench].filter((x) => x != null).length,
    relative: total != null && bodyweightKg ? Math.round((total / bodyweightKg) * 100) / 100 : null,
  };
}
