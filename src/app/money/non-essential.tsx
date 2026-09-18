"use client";

/**
 * The non-essential view.
 *
 * Non-essential spend is the number Budget Baddies ranks on and the only one
 * you can actually act on — rent is rent. But the Money page only ever showed
 * it as one figure inside the current month, mixed into a pie with essentials,
 * and the insight line was gated on `nonEssential > 0`, so a month where you
 * behaved produced no non-essential data at all.
 *
 * Six months of it: the trend, the share of everything you spend, the share of
 * what you earn, and which categories it actually is.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { localToday } from "@/lib/dates";
import { fetchByCategory, fetchSummary, money, type CategoryTotal } from "@/lib/money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthRow {
  ym: string;
  label: string;
  nonEssential: number;
  essential: number;
  total: number;
  income: number;
  /** share of everything you spent */
  shareOfSpend: number | null;
  /** share of what you earned */
  shareOfIncome: number | null;
}

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date(localToday() + "T00:00:00");
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function bounds(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`];
}

export default function NonEssential({ months = 6 }: { months?: number }) {
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [cats, setCats] = useState<CategoryTotal[]>([]);

  useEffect(() => {
    (async () => {
      const yms = lastMonths(months);
      const out = await Promise.all(
        yms.map(async (ym) => {
          const [from, to] = bounds(ym);
          const s = await fetchSummary(from, to).catch(() => null);
          const m = Number(ym.slice(5, 7)) - 1;
          return {
            ym,
            label: MONTHS[m],
            nonEssential: s?.nonEssential ?? 0,
            essential: s?.essential ?? 0,
            total: s?.total ?? 0,
            income: s?.income ?? 0,
            shareOfSpend: s && s.total > 0 ? Math.round((s.nonEssential / s.total) * 100) : null,
            shareOfIncome: s && s.income > 0 ? Math.round((s.nonEssential / s.income) * 100) : null,
          } as MonthRow;
        })
      );
      setRows(out);
      // categories across the whole window, so a quiet month still has context
      const [from] = bounds(yms[0]);
      const [, to] = bounds(yms[yms.length - 1]);
      setCats(await fetchByCategory(from, to).catch(() => []));
    })();
  }, [months]);

  const ne = useMemo(() => cats.filter((c) => !c.essential && c.total > 0).sort((a, b) => b.total - a.total), [cats]);

  if (!rows) return <p className="card p-4 text-sm text-faint">Reading the last {months} months…</p>;

  const spent = rows.reduce((s, r) => s + r.nonEssential, 0);
  const live = rows.filter((r) => r.total > 0);
  const avg = live.length ? spent / live.length : 0;
  const thisMonth = rows[rows.length - 1];
  const prior = live.filter((r) => r.ym !== thisMonth.ym);
  const priorAvg = prior.length ? prior.reduce((s, r) => s + r.nonEssential, 0) / prior.length : null;
  const biggest = ne[0];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="mb-1 font-semibold">Non-essential, last {months} months</h2>
        <p className="text-sm text-muted">
          {spent === 0 ? (
            <>
              Nothing non-essential logged in {months} months. Either you are extremely disciplined, or some categories
              are marked essential that should not be — tap any category below to flip it.
            </>
          ) : (
            <>
              <b>{money(spent)}</b> in total, {money(avg)} in an average month.
              {priorAvg != null && thisMonth.total > 0 && (
                <>
                  {" "}
                  This month is {money(thisMonth.nonEssential)} —{" "}
                  {thisMonth.nonEssential > priorAvg ? (
                    <b className="text-danger">{money(thisMonth.nonEssential - priorAvg)} above</b>
                  ) : (
                    <b className="text-ok">{money(priorAvg - thisMonth.nonEssential)} below</b>
                  )}{" "}
                  your usual.
                </>
              )}
              {biggest && (
                <>
                  {" "}
                  Most of it is <b>{biggest.name}</b> at {money(biggest.total)} ({Math.round((biggest.total / spent) * 100)}%).
                </>
              )}
            </>
          )}
        </p>
      </div>

      <div className="h-64 card p-2">
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
            <Tooltip
              formatter={(v: number, n: string) =>
                n.includes("%") ? [`${v}%`, n] : [money(v), n]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="essential" stackId="a" name="essential" fill="#16a34a" />
            <Bar yAxisId="l" dataKey="nonEssential" stackId="a" name="non-essential" fill="#dc2626" />
            {/* the two ratios that matter, on their own axis */}
            <Line yAxisId="r" type="monotone" dataKey="shareOfSpend" name="% of spend" stroke="#f59e0b" strokeWidth={2} connectNulls dot={{ r: 3 }} />
            <Line yAxisId="r" type="monotone" dataKey="shareOfIncome" name="% of income" stroke="#4f6ef7" strokeWidth={2} connectNulls dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {ne.length > 0 && (
        <div className="card p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            What the non-essential actually is
          </p>
          <div className="h-56">
            <ResponsiveContainer>
              <ComposedChart data={ne.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v: number) => [money(v), "spent"]} />
                <Bar dataKey="total" radius={[0, 3, 3, 0]}>
                  {ne.slice(0, 10).map((c, i) => (
                    <Cell key={c.name} fill={`hsl(${(i * 37) % 360} 65% 55%)`} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
