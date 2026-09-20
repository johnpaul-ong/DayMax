"use client";

/**
 * Mine tab for a pursuit page. Renders the correct "your side" view
 * depending on the pursuit's kind:
 *   life   -> MyLife  (last 90 days + typical-day clock + weekday averages)
 *   lifts  -> MyLifts (per-exercise history)
 *   money  -> MyMoney (paycheck-based summary + spending detail)
 *   custom -> MyStat rows, one per stat (each embeds StatSection with mineOnly)
 *
 * Extracted from what used to be page.tsx's 500-line block, so the
 * community view + this view no longer share a 2 000-line file.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categoryColor, categoryName } from "@/lib/categories";
import { CHART_DANGER, CHART_OK } from "@/lib/chartColors";
import { localToday } from "@/lib/dates";
import {
  fetchMyEntries,
  type MyEntry,
  type Pursuit,
  type PursuitStat,
} from "@/lib/pursuits";
import { workMaxFrom } from "@/lib/ranking";
import DayClock, { type ClockSlot } from "../../day-clock";
import IncomeRing from "../../money/income-ring";
import StatSection from "./_stat-section";

const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function MineView({
  pursuit,
  stats,
  logHref,
  onChanged,
}: {
  pursuit: Pursuit;
  stats: PursuitStat[];
  logHref: string | null;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      {pursuit.kind === "life" && <MyLife />}
      {pursuit.kind === "lifts" && <MyLifts />}
      {logHref === "/money" && <MyMoney />}

      {logHref && (
        <Link href={logHref} className="btn-primary inline-block">
          {pursuit.kind === "life" ? "Log your day →" : pursuit.kind === "lifts" ? "Log a lift →" : "Log spending →"}
        </Link>
      )}

      {stats.map((s) => (
        <MyStat key={s.id} stat={s} isOwner={pursuit.isOwner} isMember={pursuit.isMember} onChanged={onChanged} />
      ))}

      {stats.length === 0 && !logHref && (
        <p className="card p-4 text-sm text-faint">
          Nothing to log here yet — this pursuit has no stats.
          {pursuit.isOwner && " Add one from the Community tab."}
        </p>
      )}
    </div>
  );
}

/**
 * Life -- Mine tab. Last 90 days of daily hours, a typical-day clock
 * built from ALL your logged days, a category breakdown, weekday
 * averages, focus trend, and streak card. Every panel is optional
 * and won't render if the underlying data is absent.
 */
function MyLife() {
  const [entries, setEntries] = useState<Array<{ date: string; slot: number; category: number; label: string | null }>>([]);
  const [allEntries, setAllEntries] = useState<Array<{ date: string; slot: number; category: number }>>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      const { fetchDayEntries } = await import("@/lib/data");
      const today = localToday();
      const from = new Date(today + "T00:00:00");
      from.setDate(from.getDate() - 89);
      const recent = await fetchDayEntries(localToday(from), today).catch(() => []);
      setEntries(recent.map((e) => ({ date: e.date, slot: e.slot, category: e.category, label: e.label ?? null })));
      const older = new Date(today + "T00:00:00");
      older.setFullYear(older.getFullYear() - 2);
      const all = await fetchDayEntries(localToday(older), today).catch(() => []);
      setAllEntries(all.map((e) => ({ date: e.date, slot: e.slot, category: e.category })));
      setLoaded(true);
    })();
  }, []);

  const daily = useMemo(() => {
    const HOURS_PER_SLOT = 0.25;
    const bucket = (c: number): "productive" | "brainrot" | "sleep" | "other" =>
      c === 1 || c === 2 ? "productive" : c === 6 || c === 9 ? "brainrot" : c === 0 ? "sleep" : "other";
    const byDate = new Map<string, { productive: number; brainrot: number; sleep: number; other: number }>();
    for (const e of entries) {
      const cur = byDate.get(e.date) ?? { productive: 0, brainrot: 0, sleep: 0, other: 0 };
      cur[bucket(e.category)] += HOURS_PER_SLOT;
      byDate.set(e.date, cur);
    }
    return [...byDate.entries()].sort().map(([date, v]) => ({
      date,
      ...v,
      focus: v.productive + v.brainrot > 0 ? Math.round((v.productive / (v.productive + v.brainrot)) * 1000) / 10 : null,
    }));
  }, [entries]);

  const streak = useMemo(() => {
    if (daily.length === 0) return { current: 0, best: 0 };
    const dates = new Set(daily.map((d) => d.date));
    const today = localToday();
    let cur = 0;
    let cursor = new Date(today + "T00:00:00");
    while (dates.has(localToday(cursor))) {
      cur++;
      cursor.setDate(cursor.getDate() - 1);
    }
    const sorted = [...dates].sort();
    let best = 0;
    let run = 0;
    let prev: string | null = null;
    for (const d of sorted) {
      if (prev) {
        const gap = (new Date(d + "T00:00:00").getTime() - new Date(prev + "T00:00:00").getTime()) / 86400000;
        run = gap === 1 ? run + 1 : 1;
      } else run = 1;
      best = Math.max(best, run);
      prev = d;
    }
    return { current: cur, best };
  }, [daily]);

  const totals = useMemo(() => {
    const p = daily.reduce((s, d) => s + d.productive, 0);
    const b = daily.reduce((s, d) => s + d.brainrot, 0);
    const sl = daily.reduce((s, d) => s + d.sleep, 0);
    const o = daily.reduce((s, d) => s + d.other, 0);
    return { p, b, sl, o, wm: workMaxFrom(p, b) };
  }, [daily]);

  const weekday = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const acc = names.map((n) => ({ day: n, productive: 0, brainrot: 0, count: 0 }));
    for (const d of daily) {
      const dow = new Date(d.date + "T00:00:00").getDay();
      acc[dow].productive += d.productive;
      acc[dow].brainrot += d.brainrot;
      acc[dow].count += 1;
    }
    return acc.map((a) => ({
      day: a.day,
      productive: a.count > 0 ? Math.round((a.productive / a.count) * 10) / 10 : 0,
      brainrot: a.count > 0 ? Math.round((a.brainrot / a.count) * 10) / 10 : 0,
    }));
  }, [daily]);

  const catBreakdown = useMemo(() => {
    const HOURS_PER_SLOT = 0.25;
    const totalsPerCat = new Map<number, number>();
    for (const e of entries) totalsPerCat.set(e.category, (totalsPerCat.get(e.category) ?? 0) + HOURS_PER_SLOT);
    return [...totalsPerCat.entries()]
      .map(([cat, h]) => ({ cat, name: categoryName(cat), color: categoryColor(cat), hours: Math.round(h * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);
  }, [entries]);

  const typicalSlots = useMemo(() => {
    const perSlot = new Map<number, Map<number, number>>();
    for (const e of allEntries) {
      if (!perSlot.has(e.slot)) perSlot.set(e.slot, new Map());
      const m = perSlot.get(e.slot)!;
      m.set(e.category, (m.get(e.category) ?? 0) + 1);
    }
    const out = new Map<number, ClockSlot>();
    for (const [slot, counts] of perSlot) {
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      out.set(slot, { category: cat, hint: `${Math.round((n / total) * 100)}% of days` });
    }
    return out;
  }, [allEntries]);
  const typicalDays = useMemo(() => new Set(allEntries.map((e) => e.date)).size, [allEntries]);

  if (!loaded) return <p className="text-sm text-muted">Loading your Life…</p>;
  if (daily.length === 0) return <p className="card p-4 text-sm text-faint">Nothing logged in the last 90 days.</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-semibold">Last 90 days</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Productive" value={`${totals.p.toFixed(0)}h`} />
          <Metric label="Brainrot" value={`${totals.b.toFixed(0)}h`} />
          <Metric label="WorkMax" value={`${totals.wm ?? "—"}`} />
          <Metric label="Days logged" value={String(daily.length)} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric label="Sleep" value={`${totals.sl.toFixed(0)}h`} />
          <Metric label="Current streak" value={`${streak.current}d`} />
          <Metric label="Best streak (in window)" value={`${streak.best}d`} />
        </div>
      </section>

      {typicalDays > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Your typical day</h2>
          <p className="mb-2 text-sm text-muted">{typicalDays.toLocaleString()} days collapsed onto one dial — the most common thing at each quarter hour.</p>
          <div className="card p-3">
            <DayClock slots={typicalSlots} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Hours per day</h2>
        <div className="h-56 card p-2">
          <ResponsiveContainer>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis tick={{ fontSize: 10 }} unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="productive" stackId="a" name="productive" fill={CHART_OK} />
              <Bar dataKey="brainrot" stackId="a" name="brainrot" fill={CHART_DANGER} />
              <Bar dataKey="sleep" stackId="a" name="sleep" fill="var(--chart-5)" />
              <Bar dataKey="other" stackId="a" name="other" fill="var(--chart-9)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {daily.length > 3 && (
        <section>
          <h2 className="mb-1 font-semibold">Focus score</h2>
          <p className="mb-2 text-sm text-muted">Productive ÷ (productive + brainrot) × 100, per day.</p>
          <div className="h-52 card p-2">
            <ResponsiveContainer>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="focus" stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Average by weekday</h2>
        <p className="mb-2 text-sm text-muted">Do your Mondays look like your Saturdays? (h per day of week.)</p>
        <div className="h-52 card p-2">
          <ResponsiveContainer>
            <BarChart data={weekday}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="productive" fill={CHART_OK} />
              <Bar dataKey="brainrot" fill={CHART_DANGER} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {catBreakdown.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Where the hours went</h2>
          <p className="mb-2 text-sm text-muted">Every logged 15 minutes, bucketed. Colours match the day-grid.</p>
          <div className="card divide-y">
            {catBreakdown.map((c) => {
              const pct = totals.p + totals.b + totals.sl + totals.o > 0
                ? (c.hours / (totals.p + totals.b + totals.sl + totals.o)) * 100
                : 0;
              return (
                <div key={c.cat} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-faint tabular-nums">{Math.round(pct)}%</span>
                    <span className="w-14 text-right tabular-nums text-sm font-semibold">{c.hours}h</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full" style={{ width: `${pct}%`, background: c.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** Your own lifting history, per exercise. */
function MyLifts() {
  const [rows, setRows] = useState<Array<{ date: string; exercise: string; weightKg: number | null }>>([]);
  const [ex, setEx] = useState("");
  useEffect(() => {
    import("@/lib/data").then(({ fetchLifts }) =>
      fetchLifts()
        .then((ls) => {
          setRows(ls);
          if (ls.length) {
            const counts = new Map<string, number>();
            for (const l of ls) counts.set(l.exercise, (counts.get(l.exercise) ?? 0) + 1);
            setEx([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
          }
        })
        .catch(() => {})
    );
  }, []);
  const exercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);
  const series = useMemo(
    () =>
      rows
        .filter((r) => r.exercise === ex && r.weightKg != null)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, weight: r.weightKg })),
    [rows, ex]
  );
  if (rows.length === 0) return <p className="card p-4 text-sm text-faint">No lifts logged yet.</p>;

  const best = Math.max(...series.map((s) => Number(s.weight ?? 0)), 0);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Your lifts</h2>
        <select value={ex} onChange={(e) => setEx(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
          {exercises.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Sessions" value={String(series.length)} />
        <Metric label="Best" value={`${best}kg`} />
        <Metric label="Exercises" value={String(exercises.length)} />
      </div>
      {series.length > 1 && (
        <div className="h-56 card p-2">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
              <Tooltip />
              <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/**
 * Your spending this month, without leaving the pursuit.
 * IncomeRing (same shape as everyone-else on Community) + a
 * category expand-to-detail list. Range is "since your last
 * paycheck" — the pay-period you actually live in.
 */
function MyMoney() {
  const [sum, setSum] = useState<{ total: number; essential: number; nonEssential: number; income: number; nonEssentialPct: number | null } | null>(null);
  const [byCat, setByCat] = useState<Array<{ categoryId: string | null; name: string; essential: boolean; total: number }>>([]);
  const [entries, setEntries] = useState<Array<{ id: string; date: string; amount: number; categoryId: string | null; item: string | null }>>([]);
  const [cats, setCats] = useState<Array<{ id: string; name: string; essential: boolean }>>([]);
  const [rangeLabel, setRangeLabel] = useState<string>("");
  useEffect(() => {
    (async () => {
      const m = await import("@/lib/money");
      const today = localToday();
      const last = await m.lastPaycheckDate().catch(() => null);
      const from = last ?? `${today.slice(0, 7)}-01`;
      const to = today;
      setRangeLabel(last ? `since your last paycheck (${last})` : "this month (no income logged yet)");
      m.fetchSummary(from, to).then(setSum).catch(() => {});
      m.fetchByCategory(from, to).then(setByCat).catch(() => {});
      m.fetchSpend(from, to).then((rs) => setEntries(rs.map((r) => ({ id: r.id, date: r.date, amount: r.amount, categoryId: r.categoryId, item: r.item ?? null })))).catch(() => {});
      m.fetchCategories().then((cs) => setCats(cs.map((c) => ({ id: c.id, name: c.name, essential: c.essential })))).catch(() => {});
    })();
  }, []);
  if (!sum) return null;

  const catById = new Map(cats.map((c) => [c.id, c]));
  type Entry = { id: string; date: string; amount: number; item: string | null };
  const grouped = new Map<string, { name: string; essential: boolean; total: number; items: Entry[] }>();
  for (const e of entries) {
    const cat = e.categoryId ? catById.get(e.categoryId) : null;
    const key = e.categoryId ?? "__uncat";
    const name = cat?.name ?? "Uncategorised";
    const essential = cat?.essential ?? false;
    if (!grouped.has(key)) grouped.set(key, { name, essential, total: 0, items: [] });
    const g = grouped.get(key)!;
    g.total += e.amount;
    g.items.push({ id: e.id, date: e.date, amount: e.amount, item: e.item });
  }
  const rows = [...grouped.values()].sort((a, b) => b.total - a.total);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-semibold">Your pay period</h2>
        <span className="text-xs text-faint">{rangeLabel}</span>
      </div>

      <div className="card mb-4 p-4">
        <IncomeRing
          slices={byCat.map((c) => ({
            categoryId: c.categoryId,
            name: c.name,
            essential: c.essential,
            amount: c.total,
          }))}
          income={sum.income || null}
          size={280}
        />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Metric label="Spent" value={`$${sum.total.toFixed(0)}`} />
        <Metric label="Essential" value={`$${sum.essential.toFixed(0)}`} />
        <Metric label="Non-essential" value={`$${sum.nonEssential.toFixed(0)}`} />
        <Metric label="% of income" value={sum.nonEssentialPct != null ? `${sum.nonEssentialPct}%` : "—"} />
      </div>

      {rows.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">What you actually spent on</p>
          <div className="divide-y">
            {rows.map((r) => (
              <CategoryRow key={r.name} row={r} totalMonth={sum.total} />
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 && (
        <p className="card p-4 text-sm text-faint">Nothing logged this month yet.</p>
      )}
    </section>
  );
}

/** One row of the "what you actually spent on" list. Expandable. */
function CategoryRow({
  row,
  totalMonth,
}: {
  row: { name: string; essential: boolean; total: number; items: Array<{ id: string; date: string; amount: number; item: string | null }> };
  totalMonth: number;
}) {
  const [open, setOpen] = useState(false);
  const pct = totalMonth > 0 ? (row.total / totalMonth) * 100 : 0;
  const tint = row.essential ? "var(--ok)" : "var(--danger)";
  const items = [...row.items].sort((a, b) => b.amount - a.amount);
  return (
    <div className="py-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint }} />
        <span className="min-w-0 flex-1 text-sm font-medium">{row.name}</span>
        <span className="shrink-0 text-xs text-faint">{Math.round(pct)}%</span>
        <span className="shrink-0 tabular-nums text-sm font-semibold">${row.total.toFixed(0)}</span>
        <span className="shrink-0 text-xs text-faint">{open ? "▾" : "▸"}</span>
      </button>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full" style={{ width: `${pct}%`, background: tint }} />
      </div>
      {open && (
        <div className="mt-2 space-y-1 pl-4">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-xs">
              <span className="text-faint tabular-nums">{it.date.slice(5)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{it.item || row.name}</span>
              <span className="shrink-0 tabular-nums font-medium">${it.amount.toFixed(2)}</span>
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-faint">No items in this category.</p>}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** A custom stat, from YOUR side: your own series, your totals, and the form. */
function MyStat({
  stat,
  isOwner,
  isMember,
  onChanged,
}: {
  stat: PursuitStat;
  isOwner: boolean;
  isMember: boolean;
  onChanged: () => void;
}) {
  const [mine, setMine] = useState<MyEntry[]>([]);
  useEffect(() => {
    fetchMyEntries(stat.id).then(setMine).catch(() => {});
  }, [stat.id]);

  const series = useMemo(
    () => [...mine].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => ({ date: e.date, value: e.value })),
    [mine]
  );
  const total = mine.reduce((s, e) => s + e.value, 0);
  const best = mine.length ? (stat.direction === "less" ? Math.min(...mine.map((m) => m.value)) : Math.max(...mine.map((m) => m.value))) : null;

  return (
    <section>
      <h2 className="mb-2 font-semibold">{stat.name} — yours</h2>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Entries" value={String(mine.length)} />
        <Metric label={stat.cadence === "daily" ? "Total" : "Latest"} value={
          stat.cadence === "daily" ? Math.round(total).toLocaleString() : String(series[series.length - 1]?.value ?? "—")
        } />
        <Metric label={stat.direction === "less" ? "Lowest" : "Best"} value={best == null ? "—" : String(best)} />
      </div>
      {series.length > 1 && (
        <div className="mb-3 h-52 card p-2">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
              <Tooltip />
              {stat.target != null && <ReferenceLine y={stat.target} strokeDasharray="6 3" stroke="var(--accent)" />}
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <StatSection stat={stat} isOwner={isOwner} isMember={isMember} onChanged={onChanged} mineOnly />
    </section>
  );
}
