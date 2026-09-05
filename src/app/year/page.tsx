"use client";

/**
 * Year view: every day of a year as one compact table — months as rows,
 * days 1–31 as columns. Each day cell is colored by how the day went
 * (share of productive vs brainrot) or by its dominant category.
 * Click a day to open that month in the grid.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, categoryColor, categoryName, HOURS_PER_SLOT, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries, fetchBucketSettings } from "@/lib/data";
import { bucketize, hoursByCategory, productiveRatio } from "@/lib/ranking";
import { blendHex, DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";
import type { BucketSettings, DayEntry } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Mode = "buckets" | "dominant";

export default function YearPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [mode, setMode] = useState<Mode>("buckets");
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [settings, setSettings] = useState<BucketSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [bucketColors, setBucketColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);

  useEffect(() => {
    setBucketColors(loadBucketColors());
  }, []);

  useEffect(() => {
    Promise.all([fetchAllDayEntries(), fetchBucketSettings()])
      .then(([e, s]) => {
        setEntries(e);
        setSettings(s);
      })
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => {
    const ys = [...new Set(entries.map((e) => Number(e.date.slice(0, 4))))].sort();
    return ys.length ? ys : [thisYear];
  }, [entries, thisYear]);

  const byDate = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    for (const e of entries) {
      if (Number(e.date.slice(0, 4)) !== year) continue;
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return map;
  }, [entries, year]);

  function dayCell(date: string) {
    const list = byDate.get(date);
    if (!list || !settings) return null;
    const catHours = hoursByCategory(list);
    if (mode === "dominant") {
      const top = Object.entries(catHours).sort(([, a], [, b]) => b - a)[0];
      const code = Number(top[0]);
      return {
        color: categoryColor(code),
        opacity: Math.min(1, list.length / 96 + 0.25),
        tip: `${date}: mostly ${categoryName(code)} (${top[1].toFixed(1)}h), ${(list.length * HOURS_PER_SLOT).toFixed(1)}h logged`,
      };
    }
    const t = bucketize(catHours, settings);
    const scored = t.productive + t.brainrot;
    if (scored === 0)
      return { color: "var(--faint)", opacity: 0.35, tip: `${date}: ${(list.length * HOURS_PER_SLOT).toFixed(1)}h logged, nothing productive or brainrot` };
    const p = t.productive / scored; // 0 = all brainrot, 1 = all productive
    const color = blendHex(bucketColors.brainrot, bucketColors.productive, p);
    return {
      color,
      opacity: Math.min(1, list.length / 96 + 0.25),
      tip: `${date}: ${t.productive.toFixed(1)}h productive, ${t.brainrot.toFixed(1)}h brainrot (ratio ${productiveRatio(t) ?? "∞"})`,
    };
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">Year</h1>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="field w-auto py-1">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(["buckets", "dominant"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1 ${mode === m ? "bg-surface font-semibold" : "text-muted"}`}
            >
              {m === "buckets" ? "Productive vs brainrot" : "Dominant category"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading year…</p>
      ) : (
        <div className="card overflow-x-auto p-4">
          <table className="border-separate" style={{ borderSpacing: 3 }}>
            <thead>
              <tr>
                <th className="pr-2 text-left text-xs font-medium text-faint">·</th>
                {Array.from({ length: 31 }, (_, i) => (
                  <th key={i} className="text-center text-[10px] font-normal text-faint">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((name, m) => {
                const daysInMonth = new Date(year, m + 1, 0).getDate();
                const ym = `${year}-${String(m + 1).padStart(2, "0")}`;
                return (
                  <tr key={m}>
                    <td className="pr-2 text-xs font-medium text-muted">
                      <Link href={`/day?m=${ym}`} className="hover:text-accent">{name}</Link>
                    </td>
                    {Array.from({ length: 31 }, (_, i) => {
                      if (i >= daysInMonth) return <td key={i} />;
                      const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
                      const cell = dayCell(date);
                      return (
                        <td key={i}>
                          <Link
                            href={`/day?m=${ym}`}
                            title={cell?.tip ?? `${date}: not logged`}
                            className="block h-4 w-4 rounded-[4px] transition hover:scale-125"
                            style={{ background: cell ? cell.color : "var(--surface-2)", opacity: cell?.opacity ?? 1 }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-faint">
            {mode === "buckets"
              ? "Productive vs brainrot colors from your Settings. Faded = partially logged. Hover for numbers, click to open the grid."
              : "Colored by the category you spent the most time on. Hover for details."}
          </p>
        </div>
      )}

      {!loading && <DayStrip year={year} byDate={byDate} />}
    </div>
  );
}

/**
 * Every logged day of the year, side by side, as full 96-slot vertical bars —
 * midnight at the top, midnight at the bottom. Scroll through your year.
 */
function DayStrip({ year, byDate }: { year: number; byDate: Map<string, DayEntry[]> }) {
  const days = useMemo(
    () =>
      [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, list]) => {
          const slots = new Array<number | null>(SLOTS_PER_DAY).fill(null);
          const labels = new Array<string | null>(SLOTS_PER_DAY).fill(null);
          for (const e of list) {
            slots[e.slot] = e.category;
            labels[e.slot] = e.label;
          }
          return { date, slots, labels };
        }),
    [byDate]
  );

  if (days.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-1 font-semibold">Every day, every 15 minutes</h2>
      <p className="mb-2 text-sm text-muted">
        {days.length} logged days in {year} — {(days.length * 96).toLocaleString()} slots. Click a day to open it in the grid.
      </p>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {CATEGORIES.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
      <div className="card overflow-x-auto p-4">
        <div className="flex items-end gap-[3px]" style={{ minWidth: days.length * 13 }}>
          {days.map(({ date, slots, labels }) => (
            <Link key={date} href={`/day?m=${date.slice(0, 7)}`} className="flex flex-col items-center">
              <div className="flex h-[288px] w-[10px] flex-col overflow-hidden rounded-full transition hover:scale-x-150">
                {slots.map((cat, s) => (
                  <div
                    key={s}
                    title={`${date} ${slotToTime(s)}${cat != null ? ` — ${categoryName(cat)}${labels[s] ? ` (${labels[s]})` : ""}` : ""}`}
                    className="w-full flex-1"
                    style={{ background: cat != null ? categoryColor(cat) : "var(--surface-2)" }}
                  />
                ))}
              </div>
              <span
                className="mt-1 text-[8px] text-faint"
                style={{ writingMode: "vertical-rl" }}
              >
                {date.slice(5)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
