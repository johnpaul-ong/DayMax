"use client";

/**
 * Squat, deadlift and bench on one chart, plus the total.
 *
 * They were three separate lines behind an exercise dropdown, so the number
 * lifters actually quote — the total — appeared nowhere, and you could not see
 * which lift was carrying the progress and which had stalled.
 *
 * Shown on Home and on every profile, so it works for your own data and for
 * someone else's.
 */

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BIG_THREE, bigThreeSeries, bigThreeSummary, type LiftLike } from "@/lib/liftGroups";

export default function BigThree({
  rows,
  bodyweightKg,
  title = "The big three",
  compact = false,
}: {
  rows: LiftLike[];
  bodyweightKg?: number | null;
  title?: string;
  compact?: boolean;
}) {
  const series = useMemo(() => bigThreeSeries(rows), [rows]);
  const s = useMemo(() => bigThreeSummary(rows, bodyweightKg), [rows, bodyweightKg]);

  if (series.length === 0) return null;

  const first = series.find((p) => p.total != null);
  const gained = first && s.total != null ? s.total - first.total! : null;

  return (
    <section>
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="mb-2 text-sm text-muted">
        {s.total != null ? (
          <>
            Total <b>{s.total}kg</b>
            {s.relative != null && <> · {s.relative}× bodyweight</>}
            {gained != null && gained > 0 && <> · up {gained}kg since the first full set of three</>}
            . Squat {s.squat}, deadlift {s.deadlift}, bench {s.bench}.
          </>
        ) : (
          <>
            {s.covered} of 3 logged so far — a total needs all three, so it appears once you have logged the{" "}
            {BIG_THREE.filter((b) => s[b.key] == null).map((b) => b.label.toLowerCase()).join(" and ")}.
          </>
        )}
      </p>
      <div className={`${compact ? "h-56" : "h-72"} card p-2`}>
        <ResponsiveContainer>
          <ComposedChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            {/*
             * X-axis tickFormatter was `d.slice(2, 7)` -- that's chars 2..6
             * which spells "26-01" for every 2026-01-* date. So every tick
             * looked identical. Now: MM-DD when the whole series fits in
             * one calendar year, YYYY-MM otherwise. minTickGap keeps them
             * from stacking on a busy series.
             */}
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9 }}
              tickFormatter={(d: string) => {
                if (series.length === 0) return d;
                const spansYears = series[0].date.slice(0, 4) !== series[series.length - 1].date.slice(0, 4);
                return spansYears ? d.slice(0, 7) : d.slice(5);
              }}
              minTickGap={32}
            />
            <YAxis tick={{ fontSize: 10 }} unit="kg" domain={["auto", "auto"]} />
            <Tooltip formatter={(v: number, n: string) => [`${v}kg`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {/*
             * Total: monotone area, connectNulls so it stays continuous;
             * this is the RUNNING TOTAL, so a smooth curve upward is the
             * right shape. Dots hidden -- the individual lifts carry the
             * PR markers.
             */}
            <Area
              type="monotone"
              dataKey="total"
              name="total"
              stroke="var(--accent)"
              fill="var(--accent)"
              fillOpacity={0.1}
              strokeWidth={2}
              connectNulls
              dot={false}
            />
            {/*
             * Per-lift lines: bigThreeSeries now only emits a value on a
             * date where that lift's best CHANGED (see lib/liftGroups.ts).
             * With connectNulls, monotone curves smoothly between PRs,
             * so the line reads as an upward trend rather than a flat
             * plateau punctuated by a step. Dots on every real point so
             * each PR is visible.
             */}
            {BIG_THREE.map((b) => (
              <Line
                key={b.key}
                type="monotone"
                dataKey={b.key}
                name={b.label}
                stroke={b.color}
                strokeWidth={2}
                connectNulls
                dot={{ r: 3, fill: b.color, stroke: b.color }}
                activeDot={{ r: 5 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
