"use client";

/**
 * Home: your daily scoreboard — and yours to arrange. Customize lets you
 * reorder and hide sections; the layout is saved on this device.
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries, fetchBucketSettings, fetchDayEntries, fetchLifts, fetchProfile } from "@/lib/data";
import { lifeStats, type LifeStats } from "@/lib/life";
import { bucketize, focusScore, hoursByCategory, weekStart, workMax } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import StreakCard from "./streak-card";
import InstallPrompt from "./install-prompt";
import ShareCard from "./share-card";
import type { BucketSettings, DayEntry } from "@/lib/types";
import { localToday } from "@/lib/dates";
import Recap from "./recap";

// ---------- customizable layout ----------

const HOME_SECTIONS = [
  { key: "strip", label: "Every day, every 15 minutes" },
  { key: "todayWeek", label: "Today & this week" },
  { key: "life", label: "Your life" },
] as const;
type HomeKey = (typeof HOME_SECTIONS)[number]["key"];
// Legacy layout keys ("today" and "week", superseded by "todayWeek") may still
// be present in old saved layouts. loadLayout drops any key not in HOME_SECTIONS,
// so migration is silent: the user just stops seeing the two duplicate blocks
// they never asked for.
const DEFAULT_LAYOUT: Array<{ key: HomeKey; visible: boolean }> = [
  { key: "todayWeek", visible: true },
  { key: "life", visible: true },
  { key: "strip", visible: false },
];

function loadLayout(): Array<{ key: HomeKey; visible: boolean }> {
  try {
    const raw = localStorage.getItem("daymax-home-layout");
    if (!raw) return [...DEFAULT_LAYOUT];
    const saved = JSON.parse(raw) as Array<{ key: string; visible: boolean }>;
    // Migrate: anyone with an old layout that lists 'today'/'week' visible
    // gets todayWeek in their layout too, once. Existing choices preserved.
    const hasNew = saved.some((s) => s.key === "todayWeek");
    if (!hasNew) saved.unshift({ key: "todayWeek", visible: true });
    const known = saved.filter((s): s is { key: HomeKey; visible: boolean } =>
      HOME_SECTIONS.some((h) => h.key === s.key)
    );
    for (const d of DEFAULT_LAYOUT) if (!known.some((s) => s.key === d.key)) known.push(d);
    return known;
  } catch {
    return [...DEFAULT_LAYOUT];
  }
}

/**
 * A tiny stylised day-clock, drawn from primitives. Four colour swatches sit
 * around a soft ring and one accent wedge, giving the empty state a shape
 * that hints at what the app is for without shipping any external asset.
 */
function EmptyClockArt() {
  const wedge = (start: number, end: number, fill: string, opacity = 1) => {
    const toXY = (deg: number) => {
      const r = ((deg - 90) * Math.PI) / 180;
      return [100 + 78 * Math.cos(r), 100 + 78 * Math.sin(r)];
    };
    const [x1, y1] = toXY(start);
    const [x2, y2] = toXY(end);
    const large = end - start > 180 ? 1 : 0;
    return (
      <path
        d={`M100 100 L${x1} ${y1} A78 78 0 ${large} 1 ${x2} ${y2} Z`}
        fill={fill}
        opacity={opacity}
      />
    );
  };
  return (
    <svg viewBox="0 0 200 200" className="mx-auto h-32 w-32" aria-hidden="true">
      <circle cx="100" cy="100" r="90" fill="var(--surface-2)" opacity="0.6" />
      {/* stylised sample day: work morning, break, exercise, evening */}
      {wedge(0, 120, "var(--accent)", 0.55)}
      {wedge(120, 165, "#f59e0b", 0.55)}
      {wedge(165, 235, "#16a34a", 0.55)}
      {wedge(235, 360, "#94a3b8", 0.4)}
      <circle cx="100" cy="100" r="46" fill="var(--surface)" />
      {/* clock hands */}
      <line x1="100" y1="100" x2="100" y2="66" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <line x1="100" y1="100" x2="126" y2="108" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="100" cy="100" r="4" fill="var(--ink)" />
      {/* four quarter ticks */}
      {[0, 90, 180, 270].map((deg) => {
        const r = ((deg - 90) * Math.PI) / 180;
        const x1 = 100 + 84 * Math.cos(r);
        const y1 = 100 + 84 * Math.sin(r);
        const x2 = 100 + 92 * Math.cos(r);
        const y2 = 100 + 92 * Math.sin(r);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" />;
      })}
    </svg>
  );
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
      {/* One grid, 52 fluid columns wide, so it always spans the card end to end. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.25rem repeat(52, minmax(0, 1fr))",
          gap: 2,
          alignItems: "center",
          width: "100%",
        }}
      >
        {Array.from({ length: Math.ceil(totalWeeks / 52) }, (_, year) => (
          <Fragment key={year}>
            <span className="pr-1 text-right font-mono text-[8px] leading-none text-faint">
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
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 2,
                    background: i < livedWeeks ? "var(--accent)" : "var(--surface-2)",
                    opacity: i < livedWeeks ? 0.85 : 1,
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">Every square is one week; every row is one year of your life (numbers = your age). The gray ones are all you have — make the slots count.</p>
    </div>
  );
}

function YearStrip({ entries, showUnlogged }: { entries: DayEntry[]; showUnlogged: boolean }) {
  const days = useMemo(() => {
    const byDate = new Map<string, { slots: (number | null)[]; labels: (string | null)[] }>();
    for (const e of entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, { slots: new Array(SLOTS_PER_DAY).fill(null), labels: new Array(SLOTS_PER_DAY).fill(null) });
      const d = byDate.get(e.date)!;
      d.slots[e.slot] = e.category;
      d.labels[e.slot] = e.label;
    }
    // Every calendar day from your first log to today, so days you never
    // touched are visible as gaps rather than silently closing up.
    const all = [...byDate.keys()].sort();
    if (all.length === 0) return [];
    const out: Array<[string, { slots: (number | null)[]; labels: (string | null)[] }]> = [];
    const d = new Date(all[0] + "T00:00:00");
    const end = new Date(localToday() + "T00:00:00");
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const row = byDate.get(iso);
      if (row) out.push([iso, row]);
      else if (showUnlogged)
        out.push([iso, { slots: new Array(SLOTS_PER_DAY).fill(null), labels: new Array(SLOTS_PER_DAY).fill(null) }]);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [entries, showUnlogged]);

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
  const todayISO = localToday();
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
  const [sharing, setSharing] = useState(false);
  const [showUnlogged, setShowUnlogged] = useState(true);
  // "has the user logged ANYTHING ever?" — null while we're still checking.
  // We only bother once weekEntries has resolved to empty; an active user
  // (weekEntries > 0) short-circuits to true and skips these fetches.
  const [hasAnyEntries, setHasAnyEntries] = useState<boolean | null>(null);
  const [hasAnyLifts, setHasAnyLifts] = useState<boolean | null>(null);
  useEffect(() => {
    try { setShowUnlogged(localStorage.getItem("daymax-show-unlogged") !== "0"); } catch {}
  }, []);
  function toggleUnlogged() {
    setShowUnlogged((v) => {
      const next = !v;
      try { localStorage.setItem("daymax-show-unlogged", next ? "1" : "0"); } catch {}
      return next;
    });
  }

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

  // First-run detection: once the initial week+settings fetch settles, decide
  // whether this looks like a brand new user. If they have anything logged
  // this week we already know they're active. Otherwise ask "have they ever
  // logged anything, anywhere". Both flags must resolve before we replace the
  // page body — a flash of the empty state for a returning user is nearly as
  // bad as the wall of zeros we're trying to avoid.
  useEffect(() => {
    if (loading) return;
    if (weekEntries.length > 0) {
      if (hasAnyEntries !== true) setHasAnyEntries(true);
      if (hasAnyLifts !== true) setHasAnyLifts(true);
      return;
    }
    if (hasAnyEntries === null) {
      if (allEntries !== null) {
        setHasAnyEntries(allEntries.length > 0);
      } else {
        fetchAllDayEntries()
          .then((es) => {
            setAllEntries(es);
            setHasAnyEntries(es.length > 0);
          })
          .catch(() => setHasAnyEntries(false));
      }
    }
    if (hasAnyLifts === null) {
      fetchLifts()
        .then((ls) => setHasAnyLifts(ls.length > 0))
        .catch(() => setHasAnyLifts(false));
    }
  }, [loading, weekEntries.length, allEntries, hasAnyEntries, hasAnyLifts]);

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
  // days between your first log and today with nothing on them at all
  const unloggedDays = useMemo(() => {
    if (!allEntries || allEntries.length === 0) return 0;
    const have = new Set(allEntries.map((e) => e.date));
    const all = [...have].sort();
    let n = 0;
    const d = new Date(all[0] + "T00:00:00");
    const end = new Date(todayISO + "T00:00:00");
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!have.has(iso)) n++;
      d.setDate(d.getDate() + 1);
    }
    return n;
  }, [allEntries, todayISO]);

  const todayTotals = useMemo(() => (settings ? bucketize(hoursByCategory(todayEntries), settings) : null), [todayEntries, settings]);
  const weekTotals = useMemo(() => (settings ? bucketize(hoursByCategory(weekEntries), settings) : null), [weekEntries, settings]);

  const todayTopCats = useMemo(() => {
    const h = hoursByCategory(todayEntries);
    return Object.entries(h)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([code, hours]) => ({ code: Number(code), hours }));
  }, [todayEntries]);

  // Each section emits multiple bento tiles as a Fragment: a full-width label
  // row, then individual Stat tiles spanning 2 or 3 of the 6-track grid. The
  // stat sizes were chosen so a section fills exactly two rows (2+2+2 then
  // 3+3), which keeps the bento grid on a clean 6-column beat. Each wrapper is
  // a flex container so Stat's existing `flex-1` lets the card stretch to the
  // row's tallest sibling — otherwise tiles with `sub` text tower over plain
  // ones and the row looks ragged.
  function statTiles(t: ReturnType<typeof bucketize> | null) {
    return (
      <>
        <div className="flex sm:col-span-2"><Stat label="Focused" value={`${(t?.productive ?? 0).toFixed(1)}h`} sub="work + sports" color={colors.productive} /></div>
        <div className="flex sm:col-span-2"><Stat label="Downtime" value={`${(t?.brainrot ?? 0).toFixed(1)}h`} sub="leisure + other" color={colors.brainrot} /></div>
        <div className="flex sm:col-span-2"><Stat label="Other" value={`${(t?.other ?? 0).toFixed(1)}h`} color={colors.other} /></div>
        <div className="flex sm:col-span-3"><Stat label="Focus %" value={t && focusScore(t) !== null ? `${focusScore(t)}` : "—"} sub="of your logged hours" /></div>
        <div className="flex sm:col-span-3"><Stat label="WorkMax" value={t && workMax(t) !== null ? `${workMax(t)}` : "—"} sub="focus × productive hours" /></div>
      </>
    );
  }

  const SECTION_RENDER: Record<HomeKey, () => React.ReactNode> = {
    strip: () => (
      <Fragment key="strip">
        <div className="flex flex-wrap items-baseline gap-2 sm:col-span-6">
          <h2 className="text-sm font-semibold text-muted">Every day, every 15 minutes</h2>
          {allEntries !== null && unloggedDays > 0 && (
            <button
              onClick={toggleUnlogged}
              aria-pressed={showUnlogged}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                showUnlogged ? "bg-accent-soft text-accent" : "text-faint hover:text-ink"
              }`}
            >
              {showUnlogged ? "✓ " : ""}{unloggedDays} unlogged {unloggedDays === 1 ? "day" : "days"}
            </button>
          )}
        </div>
        <div className="sm:col-span-6">
          {allEntries === null ? (
            <p className="text-sm text-faint">Loading your year…</p>
          ) : (
            <YearStrip entries={allEntries} showUnlogged={showUnlogged} />
          )}
        </div>
      </Fragment>
    ),
    todayWeek: () => (
      <div key="todayweek" className="card p-4 sm:col-span-6">
        {/* Today AND this week in ONE compact card. The old layout rendered
            a full 5-tile row twice -- once for Today, once for This week --
            so WorkMax and Focus each appeared FIVE times down the page. */}
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="font-semibold">Today &amp; this week</h2>
          <span className="text-xs text-faint">·</span>
          <span className="text-xs text-muted">from {ws.slice(5)}</span>
          {todayTopCats.slice(0, 3).map((c) => (
            <span key={c.code} className="ml-auto inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium last:mr-0">
              <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c.code) }} />
              {categoryName(c.code)} · {c.hours.toFixed(1)}h
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <span className="text-xs text-faint">Metric</span>
          <span className="text-right text-xs font-medium uppercase tracking-wider text-faint">Today</span>
          <span className="text-right text-xs font-medium uppercase tracking-wider text-faint">This week</span>

          {/* one row per metric -- no more parallel columns of five duplicated cards */}
          {[
            { label: "Focused", get: (t: ReturnType<typeof bucketize> | null) => t ? `${t.productive.toFixed(1)}h` : "—", color: colors.productive },
            { label: "Downtime", get: (t: ReturnType<typeof bucketize> | null) => t ? `${t.brainrot.toFixed(1)}h` : "—", color: colors.brainrot },
            { label: "Other",    get: (t: ReturnType<typeof bucketize> | null) => t ? `${t.other.toFixed(1)}h` : "—",   color: colors.other },
            { label: "Focus %",  get: (t: ReturnType<typeof bucketize> | null) => t && focusScore(t) !== null ? `${focusScore(t)}` : "—" },
            { label: "WorkMax",  get: (t: ReturnType<typeof bucketize> | null) => t && workMax(t) !== null ? `${workMax(t)}` : "—" },
          ].map((r) => (
            <Fragment key={r.label}>
              <span className="flex items-center gap-2 text-muted">
                {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
                {r.label}
              </span>
              <span className="text-right tabular-nums stat-num" style={{ fontSize: "1.15rem" }}>{r.get(todayTotals)}</span>
              <span className="text-right tabular-nums text-muted">{r.get(weekTotals)}</span>
            </Fragment>
          ))}
        </div>
      </div>
    ),
    life: () =>
      life ? (
        <div key="life" className="sm:col-span-6">
          <LifeCard life={life} country={country} />
        </div>
      ) : null,
  };

  // Empty first-run: never logged a slot, never logged a lift, nothing this
  // week either. Show one invitation instead of six cards full of zeros.
  const detecting =
    loading || (weekEntries.length === 0 && (hasAnyEntries === null || hasAnyLifts === null));
  const isEmpty = !detecting && weekEntries.length === 0 && hasAnyEntries === false && hasAnyLifts === false;

  if (detecting) {
    // A blank pause is better than a flash of zeros. StreakCard, LifeCard, etc.
    // stay unmounted until we know whether the user actually has data behind
    // them, so nothing renders "0" in the interim.
    return (
      <div className="mx-auto max-w-2xl pt-16 text-center">
        <p className="text-sm text-muted">Getting your day ready…</p>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl pt-6 sm:pt-10">
        <div className="card p-8 text-center sm:p-10">
          <EmptyClockArt />
          <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Your life, one slot at a time.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted sm:text-base">
            DayMax is a clock. Tap any 15-minute slot and say what you were doing.
            Everything else — your week, your year, your streak — is drawn from
            those slots as you fill them in.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/today"
              className="btn-primary px-6 py-3 text-base"
            >
              Log your first slot →
            </Link>
            <Link
              href="/pursuits/explore"
              className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              or explore what other people track
            </Link>
          </div>
        </div>
      </div>
    );
  }

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

      {/* only pitch installing once they've actually logged something */}
      <InstallPrompt canPrompt={weekEntries.length > 20} />

      {/* Bento: 6-track grid so tiles can span 2/3/6 for mixed sizes on desktop,
          collapsing to a single column on mobile. StreakCard sits as a full-
          width hero; each customizable section unfolds into a header tile plus
          its own stat tiles, so reorder / hide still works via the layout map. */}
      <div className="bento">
        <div className="sm:col-span-6">
          <StreakCard />
        </div>
        {loading ? (
          <p className="text-sm text-muted sm:col-span-6">Loading your day…</p>
        ) : (
          layout.filter((s) => s.visible).map((s) => SECTION_RENDER[s.key]())
        )}
      </div>

      <Recap />

      {/* A poster of your year is a lovely thing to have and a terrible thing
          to be shown every single visit — the home page was six stacked
          sections deep before this one. Folded away until asked for. */}
      {weekEntries.length > 0 && (
        <div>
          <button
            onClick={() => setSharing((v) => !v)}
            aria-expanded={sharing}
            className="text-sm font-medium text-muted transition hover:text-accent"
          >
            {sharing ? "▾" : "▸"} Share your year as an image
          </button>
          {sharing && (
            <div className="mt-2">
              <ShareCard />
            </div>
          )}
        </div>
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
