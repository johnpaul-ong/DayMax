"use client";

/**
 * The strength card. One session and it already says something.
 *
 * A line chart of one point is nothing. This card renders from a single lift
 * by comparing it to something known — either bodyweight if you have it (an
 * unrivalled floor for "is this good") or the population norms below.
 *
 *   ONE lift:    ratio of lift ÷ bodyweight, plus a plain-English band
 *                (novice / intermediate / advanced) and how far off the next
 *                band you are, in kg
 *   THREE:       the big-three donut (which of squat/deadlift/bench you have)
 *   TEN:         a spark strip of your bests, so progress is visible
 *
 * Bands are only rough guides — the point is to give a NEW user something to
 * react to, not to score them. Every band is qualified in the tooltip.
 */

import { useMemo } from "react";
import { BIG_THREE, bigThreeSummary, type LiftLike } from "@/lib/liftGroups";

/**
 * Rough strength standards for adult males, expressed as multiples of
 * bodyweight. Source: reasonable averages across ExRx / Symmetric Strength /
 * Strength Level. Not medical, not competitive; qualified in the UI.
 */
const BANDS: Record<"squat" | "deadlift" | "bench", Array<[string, number]>> = {
  squat:    [["novice", 1.0], ["intermediate", 1.5], ["advanced", 2.0], ["elite", 2.5]],
  deadlift: [["novice", 1.25], ["intermediate", 1.75], ["advanced", 2.25], ["elite", 2.75]],
  bench:    [["novice", 0.75], ["intermediate", 1.0], ["advanced", 1.5], ["elite", 2.0]],
};

interface Props {
  rows: LiftLike[];
  bodyweightKg?: number | null;
}

export default function LiftStrengthCard({ rows, bodyweightKg }: Props) {
  const summary = useMemo(() => bigThreeSummary(rows, bodyweightKg), [rows, bodyweightKg]);
  const bestLift = useMemo(() => bestBigLift(summary, bodyweightKg), [summary, bodyweightKg]);
  const sessions = rows.length;

  if (sessions === 0) return null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">Strength card</h2>
        <span className="text-xs text-faint">{sessions} session{sessions === 1 ? "" : "s"}</span>
      </div>

      {/* Row 1: the three big lifts as a compact donut. Missing ones are dim. */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <BigThreeDonut summary={summary} />
        <div className="min-w-40 flex-1">
          {bestLift ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Your best lift</p>
              <p className="mt-0.5 text-3xl font-bold tabular-nums" style={{ letterSpacing: "-0.02em" }}>
                {bestLift.weight}
                <span className="ml-1 text-base font-normal text-faint">kg</span>
              </p>
              <p className="text-sm text-muted">
                {labelFor(bestLift.key)}
                {bestLift.ratio != null && (
                  <>
                    {" · "}
                    <b>{bestLift.ratio.toFixed(2)}×</b> bodyweight
                  </>
                )}
              </p>
              {bestLift.band && (
                <p className="mt-1 text-xs text-muted">
                  Roughly <b className="text-ink">{bestLift.band.name}</b> for {labelFor(bestLift.key).toLowerCase()}
                  {bestLift.band.toNext != null && (
                    <>
                      {" — "}
                      <b>{bestLift.band.toNext}kg</b> off {bestLift.band.next}
                    </>
                  )}
                  .
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Logged so far</p>
              <p className="mt-0.5 text-2xl font-bold">{sessions} session{sessions === 1 ? "" : "s"}</p>
              <p className="text-sm text-muted">
                No squat, deadlift or bench yet — those three anchor the card.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Row 2: coverage line, plain English about the totals */}
      <p className="text-sm text-muted">{summaryLine(summary, bodyweightKg)}</p>

      {!bodyweightKg && (
        <p className="mt-2 text-xs text-faint">
          Log a bodyweight in Day metrics and every number here gains a bodyweight ratio.
        </p>
      )}
    </div>
  );
}

/**
 * Big-three donut: three quadrants, each filled to the LIFT'S share of the
 * best of the three. A missing lift is a hollow slot, not absence — a
 * beginner should see the shape they are aiming at.
 */
function BigThreeDonut({ summary }: { summary: ReturnType<typeof bigThreeSummary> }) {
  const values = [summary.squat, summary.deadlift, summary.bench] as const;
  const max = Math.max(1, ...values.filter((v): v is number => v != null));
  const SIZE = 120;
  const C = SIZE / 2;
  const R = 46;
  const STROKE = 14;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={120} height={120} className="shrink-0">
      {BIG_THREE.map((b, i) => {
        const v = values[i];
        const frac = v == null ? 0 : v / max;
        // three thirds of the circle, one per lift, quarter-turned so squat is on top
        const start = -Math.PI / 2 + (i * (2 * Math.PI)) / 3;
        const end = start + ((2 * Math.PI) / 3) * frac;
        const startFull = -Math.PI / 2 + (i * (2 * Math.PI)) / 3;
        const endFull = startFull + ((2 * Math.PI) / 3) * 0.95;
        const path = (from: number, to: number) => {
          const x0 = C + R * Math.cos(from), y0 = C + R * Math.sin(from);
          const x1 = C + R * Math.cos(to), y1 = C + R * Math.sin(to);
          return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`;
        };
        return (
          <g key={b.key}>
            <path d={path(startFull, endFull)} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} strokeLinecap="round" />
            {v != null && v > 0 && (
              <path d={path(start, end)} fill="none" stroke={b.color} strokeWidth={STROKE} strokeLinecap="round" />
            )}
          </g>
        );
      })}
      <text x={C} y={C - 6} textAnchor="middle" dominantBaseline="central" className="fill-ink" style={{ fontSize: 20, fontWeight: 700 }}>
        {summary.total ?? "—"}
      </text>
      <text x={C} y={C + 14} textAnchor="middle" dominantBaseline="central" className="fill-faint" style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em" }}>
        {summary.total ? "TOTAL kg" : `${summary.covered}/3 lifts`}
      </text>
    </svg>
  );
}

function labelFor(k: "squat" | "deadlift" | "bench"): string {
  return BIG_THREE.find((b) => b.key === k)?.label ?? k;
}

/** Pick the lift the user is genuinely strongest at, RELATIVE to their bodyweight. */
function bestBigLift(summary: ReturnType<typeof bigThreeSummary>, bw?: number | null) {
  const cands = (["squat", "deadlift", "bench"] as const)
    .map((k) => ({ key: k, weight: summary[k] }))
    .filter((c): c is { key: "squat" | "deadlift" | "bench"; weight: number } => c.weight != null && c.weight > 0);
  if (cands.length === 0) return null;
  const scored = cands.map((c) => {
    const ratio = bw ? c.weight / bw : null;
    // rank by RATIO if we can, so a heavy deadlift doesn't always win
    return { ...c, ratio, sortKey: ratio ?? c.weight };
  });
  scored.sort((a, b) => b.sortKey - a.sortKey);
  const winner = scored[0];
  const band = winner.ratio != null ? bandFor(winner.key, winner.weight, winner.ratio, bw!) : null;
  return { ...winner, band };
}

function bandFor(key: "squat" | "deadlift" | "bench", weight: number, ratio: number, bw: number) {
  const bands = BANDS[key];
  let current = "below novice";
  let next: string | null = bands[0][0];
  let nextRatio = bands[0][1];
  for (let i = 0; i < bands.length; i++) {
    if (ratio >= bands[i][1]) {
      current = bands[i][0];
      next = bands[i + 1]?.[0] ?? null;
      nextRatio = bands[i + 1]?.[1] ?? bands[i][1];
    }
  }
  const toNext = next ? Math.max(1, Math.round(nextRatio * bw - weight)) : null;
  return { name: current, next, toNext };
}

function summaryLine(summary: ReturnType<typeof bigThreeSummary>, bw?: number | null): string {
  if (summary.total != null) {
    const rel = summary.relative != null ? `, ${summary.relative}× bodyweight` : "";
    return `Total ${summary.total}kg${rel}. Squat ${summary.squat}, deadlift ${summary.deadlift}, bench ${summary.bench}.`;
  }
  if (summary.covered === 0) return "Nothing on the big three yet — squat, deadlift or bench give this card its shape.";
  const missing = BIG_THREE.filter((b) => summary[b.key] == null).map((b) => b.label.toLowerCase());
  return `${summary.covered} of 3 big lifts logged. A total appears when you add ${missing.join(" and ")}.`;
}
