"use client";

/**
 * Money — built phone-first, unlike the rest of this app.
 *
 * The complaint about DayMax is that it's hard to use on a phone, and the day
 * grid is the reason: a 96-row table is a desktop artefact. Spending is the
 * opposite case — you log it standing in a shop — so this page is designed for
 * a thumb and scales UP to desktop, rather than the other way round.
 *
 * The entry flow is: type an amount on a big numeric keypad, tap a category
 * chip, done. Two taps for a repeat purchase, because the item list remembers
 * what you buy and what it usually costs.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { localToday } from "@/lib/dates";
import NonEssential from "./non-essential";
import IncomeView from "./income";
import BudgetMeter from "./budget-meter";
import IncomeRing, { type RingSlice } from "./income-ring";
import { BoardNotice, ChartEmpty } from "../empty-chart";
import { categorySwatch, GROUP_COLOR, splitAndColour } from "@/lib/moneyColors";
import {
  addIncome,
  addSpend,
  bulkCategorise,
  deleteSpend,
  fetchByCategory,
  fetchCategories,
  fetchDaily,
  fetchRecentItems,
  fetchSpend,
  fetchSummary,
  money,
  setCategoryPref,
  createCategory,
  type CategoryTotal,
  type DailyTotal,
  type RecentItem,
  type SpendCategory,
  type SpendEntry,
  type SpendSummary,
} from "@/lib/money";

const CHART_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6", "#94a3b8"];

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}
function monthEnd(iso: string) {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return `${iso.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

export default function MoneyPage() {
  const todayISO = localToday();
  const [month, setMonth] = useState(todayISO.slice(0, 7));
  const from = monthStart(`${month}-01`);
  const to = monthEnd(`${month}-01`);

  const [cats, setCats] = useState<SpendCategory[]>([]);
  const [entries, setEntries] = useState<SpendEntry[]>([]);
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  const [byCat, setByCat] = useState<CategoryTotal[]>([]);
  const [daily, setDaily] = useState<DailyTotal[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"add" | "list" | "insight">("add");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Lifted out of CategoryManager so the "it's all essential" banner can open
  // the thing it is telling you to go and change.
  const [catsOpen, setCatsOpen] = useState(false);

  function openCategories() {
    setCatsOpen(true);
    setTimeout(() => document.getElementById("categories")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function reload() {
    fetchCategories().then(setCats).catch((e) => setError(String(e.message ?? e)));
    fetchSpend(from, to).then(setEntries).catch(() => {});
    fetchSummary(from, to).then(setSummary).catch(() => {});
    fetchByCategory(from, to).then(setByCat).catch(() => {});
    fetchDaily(from, to).then(setDaily).catch(() => {});
    fetchRecentItems().then(setRecent).catch(() => {});
  }
  useEffect(reload, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCats = useMemo(() => cats.filter((c) => !c.hidden), [cats]);

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Money</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border bg-surface px-2 py-1 text-sm"
        />
        <Link href="/challenges" className="ml-auto text-sm font-medium text-accent hover:underline">
          Challenges →
        </Link>
      </div>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      {summary && summary.entries === 0 && (
        <div className="card border-2 border-accent-soft p-4">
          <h2 className="font-semibold">Start here</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Log something you bought — amount, then tap a category. That&apos;s it.</li>
            <li>
              Add your <b>income</b> below. Challenges rank people by spending as a share of income, so without it you
              appear unranked — this is the step everyone misses.
            </li>
            <li>
              Disagree with our essential/non-essential calls? Tap any category under <b>Categories</b> to flip it.
              It only changes things for you.
            </li>
          </ol>
        </div>
      )}

      {/* One-line diagnostics; the ring already SHOWS all-essential and no
          income visually, so the banner is a link, not a lecture. */}
      {summary && summary.total > 0 && summary.nonEssential === 0 && (
        <p className="mb-3 text-xs text-muted">
          All {money(summary.total)} marked essential.{" "}
          <button onClick={openCategories} className="font-medium text-accent underline">
            Change categories
          </button>
        </p>
      )}

      {summary && summary.entries > 0 && summary.income === 0 && (
        <p className="mb-3 text-xs text-warn">
          Add your income (bottom of page) so leaderboards can compare fairly — a student and a surgeon on the same board.
        </p>
      )}

      {/* THE canonical Money visual: your income for the month as a full
          ring, split into essential (cool green shades, one per category),
          non-essential (warm red shades) and unspent (grey). Same shape for
          every person; the panel version on the challenge board just tiles
          these side by side. */}
      {summary && (
        <div className="card mb-3 p-5">
          <IncomeRing
            slices={byCat.map<RingSlice>((c) => ({
              categoryId: c.categoryId,
              name: c.name,
              essential: c.essential,
              amount: c.total,
            }))}
            income={summary.income || null}
            size={300}
          />
        </div>
      )}

      {/* Deleted: <SummaryBar>. The IncomeRing above shows the same four
          numbers (spent / essential / non-essential / % of income) as
          numbers under the ring. Two copies of the same summary side by
          side was the redundancy you flagged. */}

      {/* big, thumb-sized tabs rather than a dense toolbar */}
      <div className="my-4 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        {(["add", "list", "insight"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2.5 capitalize ${tab === t ? "bg-surface font-semibold" : "text-muted"}`}
          >
            {t === "insight" ? "Where it went" : t}
          </button>
        ))}
      </div>

      {tab === "add" && (
        <QuickAdd cats={visibleCats} recent={recent} today={todayISO} onAdded={reload} />
      )}

      {tab === "list" && (
        <EntryList
          entries={entries}
          cats={cats}
          selected={selected}
          setSelected={setSelected}
          onChanged={reload}
        />
      )}

      {tab === "insight" && (
        <div className="space-y-6">
          <IncomeView />
          <NonEssential />
          <Insight byCat={byCat} daily={daily} summary={summary} />
        </div>
      )}

      <CategoryManager cats={cats} open={catsOpen} setOpen={setCatsOpen} onChanged={reload} />
      <IncomeBox today={todayISO} onAdded={reload} />
    </div>
  );
}

function SummaryBar({ s }: { s: SpendSummary }) {
  const pct = s.total > 0 ? (s.nonEssential / s.total) * 100 : 0;
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <p className="text-2xl font-bold tabular-nums">{money(s.total)}</p>
          <p className="text-xs text-muted">spent</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-ok">{money(s.essential)}</p>
          <p className="text-xs text-muted">essential</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-danger">{money(s.nonEssential)}</p>
          <p className="text-xs text-muted">non-essential</p>
        </div>
        {s.income > 0 && (
          <div>
            <p className="text-2xl font-bold tabular-nums">{s.nonEssentialPct ?? "—"}%</p>
            <p className="text-xs text-muted">of income, non-essential</p>
          </div>
        )}
      </div>
      {s.total > 0 && (
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div style={{ width: `${100 - pct}%`, background: "var(--ok, #16a34a)" }} />
          <div style={{ width: `${pct}%`, background: "#dc2626" }} />
        </div>
      )}
    </div>
  );
}

/** Amount first, category second. Nothing else is required. */
function QuickAdd({
  cats,
  recent,
  today,
  onAdded,
}: {
  cats: SpendCategory[];
  recent: RecentItem[];
  today: string;
  onAdded: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [item, setItem] = useState("");
  const [catId, setCatId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // a basket, so a shop run is one save rather than six
  const [basket, setBasket] = useState<Array<{ amount: number; item: string; categoryId: string | null }>>([]);

  const suggestions = useMemo(() => {
    const q = item.trim().toLowerCase();
    if (!q) return recent.slice(0, 6);
    return recent.filter((r) => r.item.toLowerCase().includes(q)).slice(0, 6);
  }, [item, recent]);

  function push() {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return;
    setBasket((b) => [...b, { amount: a, item: item.trim(), categoryId: catId }]);
    setAmount("");
    setItem("");
  }

  async function save() {
    const rows = [...basket];
    const a = Number(amount);
    if (Number.isFinite(a) && a > 0) rows.push({ amount: a, item: item.trim(), categoryId: catId });
    if (rows.length === 0) return;
    setBusy(true);
    try {
      await addSpend(rows.map((r) => ({ date, amount: r.amount, categoryId: r.categoryId, item: r.item || null })));
      setBasket([]);
      setAmount("");
      setItem("");
      setMsg(`Added ${rows.length} item${rows.length === 1 ? "" : "s"}.`);
      setTimeout(() => setMsg(null), 2500);
      onAdded();
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, SpendCategory[]>();
    for (const c of cats) m.set(c.grp, [...(m.get(c.grp) ?? []), c]);
    return [...m.entries()];
  }, [cats]);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold text-muted">$</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && push()}
          // inputMode decimal gives phones the numeric keypad, which is the
          // single biggest difference between "quick" and "annoying" here
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          className="w-full bg-transparent text-4xl font-bold tabular-nums outline-none"
        />
      </div>

      <input
        value={item}
        onChange={(e) => {
          setItem(e.target.value);
          const hit = recent.find((r) => r.item.toLowerCase() === e.target.value.trim().toLowerCase());
          if (hit?.categoryId) setCatId(hit.categoryId);
        }}
        placeholder="What was it? (milk, coffee, jeans…)"
        className="mt-3 w-full rounded-lg border bg-surface px-3 py-3 text-base"
      />

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.item + s.categoryId}
              onClick={() => {
                setItem(s.item);
                if (s.categoryId) setCatId(s.categoryId);
                if (s.lastAmount != null && !amount) setAmount(String(s.lastAmount));
              }}
              className="rounded-full border bg-surface px-3 py-1.5 text-sm"
            >
              {s.item}
              {s.lastAmount != null && <span className="ml-1 text-xs text-faint">{money(s.lastAmount)}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 max-h-64 overflow-y-auto">
        {grouped.map(([grp, list]) => (
          <div key={grp} className="mb-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{grp}</p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCatId(c.id)}
                  className={`rounded-full border px-3 py-2 text-sm ${
                    catId === c.id ? "bg-accent font-semibold text-accent-contrast" : "bg-surface"
                  }`}
                >
                  {c.name}
                  {!c.essential && <span className="ml-1 text-[10px] opacity-60">·</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {basket.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-2 p-2">
          <p className="mb-1 text-xs font-semibold text-muted">
            Basket · {money(basket.reduce((s, b) => s + b.amount, 0))}
          </p>
          {basket.map((b, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 text-sm">
              <span className="tabular-nums">{money(b.amount)}</span>
              <span className="truncate text-muted">{b.item || "—"}</span>
              <button
                onClick={() => setBasket((x) => x.filter((_, j) => j !== i))}
                className="ml-auto text-xs text-danger"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border bg-surface px-2 py-2 text-sm"
        />
        <button onClick={push} disabled={!amount} className="btn-ghost py-2.5">
          + another
        </button>
        <button onClick={() => void save()} disabled={busy || (!amount && basket.length === 0)} className="btn-primary flex-1 py-3 text-base">
          {busy ? "Saving…" : basket.length > 0 ? `Save ${basket.length + (amount ? 1 : 0)} items` : "Save"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-ok">{msg}</p>}
    </div>
  );
}

/** The list, with multi-select so a whole shop can be re-categorised at once. */
function EntryList({
  entries,
  cats,
  selected,
  setSelected,
  onChanged,
}: {
  entries: SpendEntry[];
  cats: SpendCategory[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onChanged: () => void;
}) {
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const [bulkCat, setBulkCat] = useState("");

  if (entries.length === 0) return <p className="card p-4 text-sm text-faint">Nothing logged this month yet.</p>;

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border-2 border-accent-soft bg-surface p-3">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded-lg border bg-surface px-2 py-1.5 text-sm">
            <option value="">Move to…</option>
            {cats.filter((c) => !c.hidden).map((c) => (
              <option key={c.id} value={c.id}>{c.grp} · {c.name}</option>
            ))}
          </select>
          <button
            onClick={() =>
              void bulkCategorise([...selected], bulkCat).then(() => {
                setSelected(new Set());
                setBulkCat("");
                onChanged();
              })
            }
            disabled={!bulkCat}
            className="btn-primary py-1.5"
          >
            Apply
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-muted">Clear</button>
        </div>
      )}

      <div className="card divide-y">
        {entries.map((e) => {
          const c = e.categoryId ? byId.get(e.categoryId) : null;
          const on = selected.has(e.id);
          return (
            <div key={e.id} className="flex items-center gap-3 px-3 py-3">
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const next = new Set(selected);
                  if (on) next.delete(e.id);
                  else next.add(e.id);
                  setSelected(next);
                }}
                className="h-5 w-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.item || c?.name || "Uncategorised"}</p>
                <p className="text-xs text-faint">
                  {e.date.slice(5)} · {c?.name ?? "Uncategorised"}
                  {c && !c.essential && <span className="ml-1 text-danger">non-essential</span>}
                </p>
              </div>
              <span className="shrink-0 tabular-nums font-semibold">{money(e.amount)}</span>
              <button onClick={() => void deleteSpend(e.id).then(onChanged)} className="shrink-0 text-xs text-danger">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Insight({
  byCat,
  daily,
  summary,
}: {
  byCat: CategoryTotal[];
  daily: DailyTotal[];
  summary: SpendSummary | null;
}) {
  if (byCat.length === 0)
    return (
      <ChartEmpty cause="no-data" noun="spending">
        Nothing logged this month, so there is nothing to break down. Log a purchase on the <b>add</b> tab and both
        charts here start working.
      </ChartEmpty>
    );
  const worst = [...byCat].filter((c) => !c.essential).sort((a, b) => b.total - a.total)[0];
  const dayCount = daily.filter((d) => d.total > 0).length;
  // colour each category from its OWN group's family, so the pie separates
  // essential from non-essential before you read a single label
  const split = splitAndColour(byCat);
  // keyed by id, not name: two categories can legitimately share a name (a
  // shared "Coffee" and one you made yourself) and the second would silently
  // take the first one's colour
  const coloured = new Map(
    [...split.essential, ...split.nonEssential].map((c) => [c.categoryId ?? c.name, c.color])
  );

  return (
    <div className="space-y-4">
      {/* The all-essential case used to be stated here too. It is now one
          banner at the top of the page, so it isn't repeated once per chart. */}
      {worst && summary && summary.nonEssential > 0 && (
        <p className="card p-4 text-sm">
          Your biggest non-essential is <b>{worst.name}</b> at {money(worst.total)} —{" "}
          {Math.round((worst.total / summary.nonEssential) * 100)}% of everything you didn&apos;t strictly need.
        </p>
      )}

      <div className="card p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">By category</p>
        <div className="h-64">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={byCat} dataKey="total" nameKey="name" label={(p: any) => p.name}>
                {byCat.map((c: CategoryTotal, i: number) => (
                  <Cell key={c.categoryId ?? c.name} fill={coloured.get(c.categoryId ?? c.name) ?? CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => money(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Day by day</p>
        {/* One day of data is a single bar and no trend; zero is an axis grid. */}
        {dayCount < 2 ? (
          <p className="text-sm text-muted">
            {dayCount === 1
              ? "One day logged this month — this fills in once there are two to compare."
              : "Nothing logged this month, so there is no day-by-day shape yet."}
          </p>
        ) : (
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => String(d).slice(8)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => money(Number(v))} />
              <Legend />
              <Bar dataKey="essential" stackId="a" name="essential" fill={GROUP_COLOR.essential} />
              <Bar dataKey="nonEssential" stackId="a" name="non-essential" fill={GROUP_COLOR.nonEssential} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </div>
    </div>
  );
}

/** Add your own categories, and disagree with our defaults. */
function CategoryManager({
  cats,
  open,
  setOpen,
  onChanged,
}: {
  cats: SpendCategory[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onChanged: () => void;
}) {
  // Same two families the charts use, so a category's colour here is the
  // colour you will meet again in the pie.
  const chipColour = new Map<string, string>();
  {
    let e = 0;
    let n = 0;
    for (const c of cats) chipColour.set(c.id, c.essential ? categorySwatch(true, e++) : categorySwatch(false, n++));
  }
  const [name, setName] = useState("");
  const [grp, setGrp] = useState("Lifestyle");
  const [essential, setEssential] = useState(false);

  return (
    <div id="categories" className="mt-6 scroll-mt-4">
      <button onClick={() => setOpen(!open)} className="text-sm font-medium text-muted hover:text-accent">
        {open ? "▾" : "▸"} Categories
      </button>
      {open && (
        <div className="card mt-2 p-4">
          <p className="mb-3 text-sm text-muted">
            Whether something is &ldquo;essential&rdquo; is your call, not ours — a gym membership is a lifeline to one
            person and the first cut for another. Tap any category to flip it.
          </p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button
                key={c.id}
                style={{ borderLeft: `4px solid ${chipColour.get(c.id) ?? "var(--border)"}` }}
                onClick={() => void setCategoryPref(c.id, { essential: !c.essential }).then(onChanged)}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  c.essential ? "border-ok/40 bg-ok-soft text-ok" : "text-muted"
                }`}
                title={c.essential ? "Essential — tap to change" : "Non-essential — tap to change"}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className="w-40 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <select value={grp} onChange={(e) => setGrp(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm">
              {["Essentials", "Subscriptions", "Lifestyle", "Other"].map((g) => <option key={g}>{g}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
              essential
            </label>
            <button
              onClick={() => {
                if (!name.trim()) return;
                void createCategory(name.trim(), grp, essential).then(() => {
                  setName("");
                  onChanged();
                });
              }}
              disabled={!name.trim()}
              className="btn-primary"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Income, because "% of what came in" is the only fair way to compare people. */
function IncomeBox({ today, onAdded }: { today: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState(today);

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="text-sm font-medium text-muted hover:text-accent">
        {open ? "▾" : "▸"} Income
      </button>
      {open && (
        <div className="card mt-2 p-4">
          <p className="mb-3 text-sm text-muted">
            Add what came in and the app can show spending as a share of income — which is how challenges rank people,
            so a student and a surgeon compete fairly.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="Amount" className="w-28 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Pay, refund…" className="w-32 rounded-lg border bg-surface px-2 py-2 text-sm" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
            <button
              onClick={() => {
                const a = Number(amount);
                if (!Number.isFinite(a) || a <= 0) return;
                void addIncome(date, a, source.trim() || undefined).then(() => {
                  setAmount("");
                  setSource("");
                  onAdded();
                });
              }}
              disabled={!amount}
              className="btn-primary"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
