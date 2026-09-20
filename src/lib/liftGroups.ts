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

/**
 * Colours come from the theme's chart palette, not literals — these three
 * lines sit on the profile next to charts that already follow the theme, and
 * hardcoded light-theme indigo next to a systemBlue UI is the exact seam the
 * shared palette exists to remove.
 */
export const BIG_THREE: Array<{ key: BigLift; label: string; color: string }> = [
  { key: "squat", label: "Squat", color: "var(--chart-1, #4f6ef7)" },
  { key: "deadlift", label: "Deadlift", color: "var(--chart-3, #dc2626)" },
  { key: "bench", label: "Bench", color: "var(--chart-2, #15803d)" },
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
 * Best weight per lift per day, PLUS the running total, in a shape that
 * plots as PROGRESSION rather than a plateau plot.
 *
 * The old series carried each lift's best forward on every date any of
 * the three moved, which meant squat sat at 140 as a dead-flat line
 * from January while bench walked up next to it -- most days on the
 * chart were empty repetition of "still 140". You spotted this.
 *
 * The new shape: each lift's line only has a value on a date where THAT
 * lift's best actually changed (a session at that weight or heavier).
 * Recharts renders that as a real trending line -- dots at every PR,
 * monotone curve between them -- with no artificial flat spans.
 * `total` still carries forward, because the total IS a running number:
 * you don't "un-total" between sessions, it's what you'd quote today.
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
    // Per-lift PR advance: value only appears on the line when it
    // moves; otherwise null -> connectNulls will curve between real
    // points so you still get a continuous trend, without a plateau.
    const change: Partial<Record<BigLift, number>> = {};
    for (const k of ["squat", "deadlift", "bench"] as BigLift[]) {
      if (day[k] != null && day[k]! > (best[k] ?? 0)) {
        best[k] = day[k]!;
        change[k] = best[k];
      }
    }
    const haveAll = best.squat != null && best.deadlift != null && best.bench != null;
    out.push({
      date,
      squat: change.squat ?? null,
      deadlift: change.deadlift ?? null,
      bench: change.bench ?? null,
      // total carries forward, because it IS the quoted number today
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
