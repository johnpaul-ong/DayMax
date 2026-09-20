"use client";

/**
 * What came in, and what survived it.
 *
 * Income existed only as a box you typed a number into and a single "% of
 * income" figure. Nothing showed whether you earn steadily, what you actually
 * keep, or how the non-essential half moves relative to what you make — which
 * is the only honest way to read spending, since £400 of fun is a different
 * thing on £2k a month than on £6k.
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
import { fetchIncome, fetchSummary, money } from "@/lib/money";
import { categorySwatch, GROUP_COLOR } from "@/lib/moneyColors";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Row {
  ym: string;
  label: string;
  income: number;
  essential: number;
  nonEssential: number;
  spent: number;
  kept: number;
  /** what you kept, as a share of what you earned */
  keptPct: number | null;
  nonEssentialPct: number | null;
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

export default function IncomeView({ months = 6 }: { months?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sources, setSources] = useState<Array<{ source: string; total: number }>>([]);

  useEffect(() => {
    (async () => {
      const yms = lastMonths(months);
      const out = await Promise.all(
        yms.map(async (ym) => {
          const [from, to] = bounds(ym);
          const s = await fetchSummary(from, to).catch(() => null);
          const income = s?.income ?? 0;
          const spent = s?.total ?? 0;
          return {
            ym,
            label: MONTHS[Number(ym.slice(5, 7)) - 1],
            income,
            essential: s?.essential ?? 0,
            nonEssential: s?.nonEssential ?? 0,
            spent,
            kept: income - spent,
            keptPct: income > 0 ? Math.round(((income - spent) / income) * 100) : null,
            nonEssentialPct: income > 0 ? Math.round(((s?.nonEssential ?? 0) / income) * 100) : null,
          } as Row;
        })
      );
      setRows(out);

      const [from] = bounds(yms[0]);
      const [, to] = bounds(yms[yms.length - 1]);
      const inc = await fetchIncome(from, to).catch(() => []);
      const m = new Map<string, number>();
      for (const i of inc) m.set(i.source || "Unlabelled", (m.get(i.source || "Unlabelled") ?? 0) + i.amount);
      setSources([...m.entries()].map(([source, total]) => ({ source, total })).sort((a, b) => b.total - a.total));
    })();
  }, [months]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const live = rows.filter((r) => r.income > 0);
    if (live.length === 0) return null;
    const earned = live.reduce((s, r) => s + r.income, 0);
    const spent = live.reduce((s, r) => s + r.spent, 0);
    const nonEss = live.reduce((s, r) => s + r.nonEssential, 0);
    const avg = earned / live.length;
    // how steady is the income? sd as a share of the mean
    const sd = Math.sqrt(live.reduce((s, r) => s + (r.income - avg) ** 2, 0) / live.length);
    return {
      months: live.length,
      earned,
      spent,
      kept: earned - spent,
      keptPct: Math.round(((earned - spent) / earned) * 100),
      nonEssPct: Math.round((nonEss / earned) * 100),
      avg,
      variability: Math.round((sd / avg) * 100),
      best: [...live].sort((a, b) => b.income - a.income)[0],
    };
  }, [rows]);

  if (!rows) return <p className="card p-4 text-sm text-faint">Reading your income…</p>;
  if (!stats)
    return (
      <p className="card p-4 text-sm text-faint">
        No income logged yet. Add it below and every percentage on this page starts working — including the one the
        challenge ranks on.
      </p>
    );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="mb-1 font-semibold">Income, last {months} months</h2>
        <p className="text-sm text-muted">
          You earned <b>{money(stats.earned)}</b> over {stats.months} month{stats.months === 1 ? "" : "s"} and kept{" "}
          <b className={stats.kept >= 0 ? "text-ok" : "text-danger"}>{money(stats.kept)}</b> of it ({stats.keptPct}%).
          Non-essential took <b>{stats.nonEssPct}%</b> of everything you made.{" "}
          {stats.variability <= 8 ? (
            <>Your income is steady — it varies by only {stats.variability}% month to month.</>
          ) : (
            <>Your income swings {stats.variability}% month to month, so judge spending as a share, not in pounds.</>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Average month" value={money(stats.avg)} />
        <Stat label="Kept" value={`${stats.keptPct}%`} tone={stats.keptPct >= 0 ? "ok" : "danger"} />
        <Stat label="Non-essential" value={`${stats.nonEssPct}%`} sub="of income" />
        <Stat label="Best month" value={money(stats.best.income)} sub={stats.best.label} />
      </div>

      <div className="h-72 card p-2">
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[-20, 100]} />
            <Tooltip formatter={(v: number, n: string) => (n.includes("%") ? [`${v}%`, n] : [money(v), n])} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="income" name="income" fill={GROUP_COLOR.income} radius={[3, 3, 0, 0]} />
            <Bar yAxisId="l" dataKey="essential" name="essential" stackId="s" fill={GROUP_COLOR.essential} />
            <Bar yAxisId="l" dataKey="nonEssential" name="non-essential" stackId="s" fill={GROUP_COLOR.nonEssential} />
            <Line yAxisId="r" type="monotone" dataKey="keptPct" name="% kept" stroke={GROUP_COLOR.saved} strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
            <Line yAxisId="r" type="monotone" dataKey="nonEssentialPct" name="non-ess % of income" stroke={GROUP_COLOR.nonEssential} strokeDasharray="4 3" strokeWidth={2} connectNulls dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {sources.length > 1 && (
        <div className="card p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Where it came from</p>
          <div className="h-48">
            <ResponsiveContainer>
              <ComposedChart data={sources} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="source" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v: number) => [money(v), "earned"]} />
                <Bar dataKey="total" radius={[0, 3, 3, 0]}>
                  {sources.map((s, i) => (
                    <Cell key={s.source} fill={categorySwatch(true, i)} />
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "danger" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
