"use client";

/**
 * Home: your daily scoreboard — and yours to arrange. Customize lets you
 * reorder and hide sections; the layout is saved on this device.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries, fetchBucketSettings, fetchDayEntries, fetchProfile } from "@/lib/data";
import { lifeStats, type LifeStats } from "@/lib/life";
import { bucketize, focusScore, hoursByCategory, weekStart } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import type { BucketSettings, DayEntry } from "@/lib/types";

// ---------- customizable layout ----------

const HOME_SECTIONS = [
  { key: "strip", label: "Every day, every 15 minutes" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "life", label: "Your life" },
] as const;
type HomeKey = (typeof HOME_SECTIONS)[number]["key"];
const DEFAULT_LAYOUT: Array<{ key: HomeKey; visible: boolean }> = [
  { key: "today", visible: true },
  { key: "week", visible: true },
  { key: "life", visible: true },
  { key: "strip", visible: false },
];

function loadLayout(): Array<{ key: HomeKey; visible: boolean }> {
  try {
    const raw = localStorage.getItem("daymax-home-layout");
    if (!raw) return [...DEFAULT_LAYOUT];
    const saved = JSON.parse(raw) as Array<{ key: HomeKey; visible: boolean }>;
    const known = saved.filter((s) => HOME_SECTIONS.some((h) => h.key === s.key));
    for (const d of DEFAULT_LAYOUT) if (!known.some((s) => s.key === d.key)) known.push(d);
    return known;
  } catch {
    return [...DEFAULT_LAYOUT];
  }
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card flex-1 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function LifeCard({ life, country }: { life: LifeStats; country: string | null }) {
  const totalWeeks = Math.round(life.expectancy * 52.18);
  const livedWeeks = Math.min(totalWeeks, Math.round(life.ageYears * 52.18));
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted">Your life</h2>
        <span className="text-xs text-faint">
          life expectancy {life.expectancy.toFixed(1)}y{country ? ` (${country})` : " (world avg)"}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-6">
        <div><p className="text-3xl font-bold tabular-nums">{life.percentLived.toFixed(1)}%</p><p className="text-xs text-muted">lived</p></div>
        <div><p className="text-3xl font-bold tabular-nums">{life.ageYears.toFixed(1)}</p><p className="text-xs text-muted">years old</p></div>
        <div><p className="text-3xl font-bold tabular-nums">{life.yearsLeft.toFixed(1)}</p><p className="text-xs text-muted">years left</p></div>
        <div><p className="text-3xl font-bold tabular-nums">{Math.round(life.ageYears * 52.18).toLocaleString()}</p><p className="text-xs text-muted">weeks already gone</p></div>
        <div><p className="text-3xl font-bold tabular-nums">{Math.round(life.weeksLeft).toLocaleString()}</p><p className="text-xs text-muted">weeks left</p></div>
      </div>
      <div className="mb-3 h-3 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${life.percentLived}%` }} />
      </div>
      <div className="overflow-x-auto">
        <div style={{ display: "inline-grid", rowGap: 2 }}>
          {Array.from({ length: Math.ceil(totalWeeks / 52) }, (_, year) => (
            <div
              key={year}
              style={{
                display: "grid",
                gridTemplateColumns: `24px repeat(52, 7px)`,
                columnGap: 2,
                alignItems: "center",
              }}
            >
              <span className="text-right font-mono text-[8px] text-faint">
                {year % 10 === 0 ? year : ""}
              </span>
              {Array.from({ length: 52 }, (_, w) => {
                const i = year * 52 + w;
                if (i >= totalWeeks) return <span key={w} />;
                return (
                  <span
                    key={w}
                    title={`Age ${year}, week ${w + 1}${i < livedWeeks ? " — lived" : ""}`}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 1.5,
                      background: i < livedWeeks ? "var(--accent)" : "var(--surface-2)",
                      opacity: i < livedWeeks ? 0.85 : 1,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">Every square is one week; every row is one year of your life (numbers = your age). The gray ones are all you have — make the slots count.</p>
    </div>
  );
}

function YearStrip({ entries }: { entries: DayEntry[] }) {
  const days = useMemo(() => {
    const byDate = new Map<string, { slots: (number | null)[]; labels: (string | null)[] }>();
    for (const e of entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, { slots: new Array(SLOTS_PER_DAY).fill(null), labels: new Array(SLOTS_PER_DAY).fill(null) });
      const d = byDate.get(e.date)!;
      d.slots[e.slot] = e.category;
      d.labels[e.slot] = e.label;
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [entries]);

  if (days.length === 0)
    return <p className="card p-4 text-sm text-faint">Nothing logged yet — your year will appear here, one bar per day.</p>;

  return (
    <div className="card overflow-x-auto p-4">
      <div className="flex items-end gap-[3px]" style={{ minWidth: days.length * 13 }}>
        {days.map(([date, d]) => (
          <Link key={date} href={`/day?m=${date.slice(0, 7)}`} className="flex flex-col items-center">
            <div className="flex h-[240px] w-[10px] flex-col overflow-hidden rounded-full transition hover:scale-x-150">
              {d.slots.map((cat, s) => (
                <div
                  key={s}
                  title={`${date} ${slotToTime(s)}${cat != null ? ` — ${categoryName(cat)}${d.labels[s] ? ` (${d.labels[s]})` : ""}` : ""}`}
                  className="w-full flex-1"
                  style={{ background: cat != null ? categoryColor(cat) : "var(--surface-2)" }}
                />
              ))}
            </div>
            <span className="mt-1 text-[8px] text-faint" style={{ writingMode: "vertical-rl" }}>{date.slice(5)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const ws = weekStart(todayISO);
  const [weekEntries, setWeekEntries] = useState<DayEntry[]>([]);
  const [allEntries, setAllEntries] = useState<DayEntry[] | null>(null);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [life, setLife] = useState<LifeStats | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [customizing, setCustomizing] = useState(false);

  const stripVisible = layout.some((s) => s.key === "strip" && s.visible);

  useEffect(() => {
    setColors(loadBucketColors());
    setLayout(loadLayout());
    Promise.all([fetchDayEntries(ws, todayISO), fetchBucketSettings()])
      .then(([e, s]) => {
        setWeekEntries(e);
        setSettings(s);
      })
      .finally(() => setLoading(false));
    fetchProfile()
      .then((p) => {
        if (p.birthDate) {
          setLife(lifeStats(p.birthDate, p.country));
          setCountry(p.country);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the year strip is heavy — only fetch when that section is shown
  useEffect(() => {
    if (stripVisible && allEntries === null) {
      fetchAllDayEntries().then(setAllEntries).catch(() => setAllEntries([]));
    }
  }, [stripVisible, allEntries]);

  function saveLayout(next: Array<{ key: HomeKey; visible: boolean }>) {
    setLayout(next);
    try {
      localStorage.setItem("daymax-home-layout", JSON.stringify(next));
    } catch {}
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...layout];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    saveLayout(next);
  }

  const todayEntries = useMemo(() => weekEntries.filter((e) => e.date === todayISO), [weekEntries, todayISO]);
  const todayTotals = useMemo(() => (settings ? bucketize(hoursByCategory(todayEntries), settings) : null), [todayEntries, settings]);
  const weekTotals = useMemo(() => (settings ? bucketize(hoursByCategory(weekEntries), settings) : null), [weekEntries, settings]);

  const todayTopCats = useMemo(() => {
    const h = hoursByCategory(todayEntries);
    return Object.entries(h)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([code, hours]) => ({ code: Number(code), hours }));
  }, [todayEntries]);

  function statRow(t: ReturnType<typeof bucketize> | null) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Stat label="Productive" value={`${(t?.productive ?? 0).toFixed(1)}h`} color={colors.productive} />
        <Stat label="Brainrot" value={`${(t?.brainrot ?? 0).toFixed(1)}h`} color={colors.brainrot} />
        <Stat label="Other" value={`${(t?.other ?? 0).toFixed(1)}h`} color={colors.other} />
        <Stat label="Focus score" value={t && focusScore(t) !== null ? `${focusScore(t)}` : "—"} sub="productive ÷ (productive + brainrot) × 100" />
      </div>
    );
  }

  const SECTION_RENDER: Record<HomeKey, () => React.ReactNode> = {
    strip: () => (
      <section key="strip">
        <h2 className="mb-2 text-sm font-semibold text-muted">Every day, every 15 minutes</h2>
        {allEntries === null ? <p className="text-sm text-faint">Loading your year…</p> : <YearStrip entries={allEntries} />}
      </section>
    ),
    today: () => (
      <section key="today">
        <h2 className="mb-2 text-sm font-semibold text-muted">Today</h2>
        {statRow(todayTotals)}
        {todayTopCats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {todayTopCats.map((c) => (
              <span key={c.code} className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(c.code) }} />
                {categoryName(c.code)} · {c.hours.toFixed(1)}h
              </span>
            ))}
          </div>
        )}
      </section>
    ),
    week: () => (
      <section key="week">
        <h2 className="mb-2 text-sm font-semibold text-muted">This week (from {ws.slice(5)})</h2>
        {statRow(weekTotals)}
      </section>
    ),
    life: () => (life ? <section key="life">{<LifeCard life={life} country={country} />}</section> : null),
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          <p className="text-sm text-muted">{todayEntries.length}/96 slots logged today</p>
        </div>

      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading your day…</p>
      ) : (
        layout.filter((s) => s.visible).map((s) => SECTION_RENDER[s.key]())
      )}

      {customizing && (
        <div className="card p-3">
          <p className="mb-2 text-xs text-muted">Reorder with the arrows, click a name to show/hide. Saved on this device.</p>
          <div className="space-y-1">
            {layout.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 text-sm">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border px-2 py-0.5 text-xs disabled:opacity-30">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === layout.length - 1} className="rounded border px-2 py-0.5 text-xs disabled:opacity-30">↓</button>
                <button
                  onClick={() => saveLayout(layout.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)))}
                  className={`rounded-full border px-3 py-1 ${s.visible ? "bg-accent-soft font-semibold text-accent" : "text-muted line-through"}`}
                >
                  {HOME_SECTIONS.find((h) => h.key === s.key)?.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <button onClick={() => setCustomizing((v) => !v)} className="btn-ghost">{customizing ? "Done customizing" : "Customize this page"}</button>
      </div>
    </div>
  );
}
