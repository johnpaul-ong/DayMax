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
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={24} />
            <YAxis tick={{ fontSize: 10 }} unit="kg" domain={["auto", "auto"]} />
            <Tooltip formatter={(v: number, n: string) => [`${v}kg`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {/* total behind, as a filled area — the shape of the whole effort */}
            <Area
              type="stepAfter"
              dataKey="total"
              name="total"
              stroke="var(--accent)"
              fill="var(--accent)"
              fillOpacity={0.1}
              strokeWidth={2}
              connectNulls
              dot={false}
            />
            {BIG_THREE.map((b) => (
              <Line
                key={b.key}
                type="stepAfter"
                dataKey={b.key}
                name={b.label}
                stroke={b.color}
                strokeWidth={2}
                connectNulls
                dot={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
