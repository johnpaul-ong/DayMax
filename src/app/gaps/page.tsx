"use client";

/**
 * Missing time.
 *
 * "My All categories sum only goes to 23.1 hours, not 24" — the maths was
 * right and the answer was unhelpful. 23.1 is what you get when most days are
 * 90-odd slots out of 96: the average is over logged time, and the rest is
 * real hours nobody wrote down. Averaging that away silently is worse than
 * saying which days it came from.
 *
 * So: the exact days, worst first, and a workbook of only those days with the
 * slots you already filled pre-populated. Fill the blanks, drop it on Import.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries, fetchDayMetrics } from "@/lib/data";
import { localToday } from "@/lib/dates";
import { findGaps, summarise, type DayGap, type GapSummary } from "@/lib/gaps";
import type { DayEntry } from "@/lib/types";
import { buildGapsXlsx } from "@/lib/xlsxIO";

/** Days missing fewer slots than this aren't worth a column in a spreadsheet. */
const PRESETS = [
  { slots: 1, label: "Everything unfinished" },
  { slots: 4, label: "Missing an hour or more" },
  { slots: 16, label: "Missing 4h or more" },
  { slots: 96, label: "Completely empty days" },
];

export default function GapsPage() {
  const [entries, setEntries] = useState<DayEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minMissing, setMinMissing] = useState(4);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const today = localToday();

  useEffect(() => {
    fetchAllDayEntries()
      .then(setEntries)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // your range is first-ever-log to today; days before you started aren't gaps
  const from = useMemo(
    () => (entries && entries.length ? entries.map((e) => e.date).sort()[0] : today),
    [entries, today]
  );

  const summary: GapSummary | null = useMemo(
    () => (entries ? summarise(entries, from, today) : null),
    [entries, from, today]
  );
  const gaps: DayGap[] = useMemo(
    () => (entries ? findGaps(entries, from, today, minMissing) : []),
    [entries, from, today, minMissing]
  );

  async function download() {
    if (!entries || gaps.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const dates = gaps.map((g) => g.date).sort();
      const metrics = await fetchDayMetrics(dates[0], dates[dates.length - 1]).catch(() => []);
      const blob = buildGapsXlsx(dates, entries, metrics);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `daymax-gaps-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`${dates.length} days across ${new Set(dates.map((d) => d.slice(0, 7))).size} sheets. Fill the blanks, then drop it on Import.`);
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!entries || !summary) return <p className="text-sm text-muted">Reading your whole history…</p>;

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <h1 className="mb-1 text-xl font-bold">Missing time</h1>
      <p className="mb-4 text-sm text-muted">
        Every day is 96 fifteen-minute slots. A day with 90 logged contributes 22.5 hours, not 24 — which is why your
        average day reads <b>{summary.averageLoggedHours}h</b> rather than 24h. The difference isn&apos;t a rounding
        error, it&apos;s {summary.missingHours.toLocaleString()} hours you haven&apos;t written down yet.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Metric label="Unfinished days" value={String(summary.incompleteDays)} />
        <Metric label="Totally blank" value={String(summary.emptyDays)} />
        <Metric label="Full 96/96 days" value={String(summary.completeDays)} />
        <Metric label="Hours missing" value={summary.missingHours.toLocaleString()} />
      </div>

      {summary.worstMonth && (
        <p className="mb-5 text-sm text-muted">
          Worst month is <b>{summary.worstMonth}</b>. Your history starts {from}.
        </p>
      )}

      <div className="card mb-5 p-4">
        <h2 className="mb-2 font-semibold">Get a spreadsheet to fill in</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.slots}
              onClick={() => setMinMissing(p.slots)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                minMissing === p.slots ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-sm text-muted">
          {gaps.length === 0
            ? "Nothing matches — that filter has no unfinished days in it."
            : `${gaps.length} day${gaps.length === 1 ? "" : "s"}, one column each, with what you already logged filled in. Only the blanks need typing.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void download()} disabled={busy || gaps.length === 0} className="btn-primary">
            {busy ? "Building…" : "Download .xlsx"}
          </button>
          <Link href="/import" className="btn-ghost">
            Import a filled one →
          </Link>
        </div>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-muted">
        Worst first {gaps.length > 60 && <span className="font-normal text-faint">· showing the first 60</span>}
      </h2>
      <div className="card divide-y">
        {gaps.slice(0, 60).map((g) => (
          <GapRow key={g.date} gap={g} />
        ))}
        {gaps.length === 0 && <p className="p-4 text-sm text-faint">Nothing to fill in. That&apos;s a full set.</p>}
      </div>
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

/** One day, with a bar showing where in the day the holes actually are. */
function GapRow({ gap }: { gap: DayGap }) {
  const missingSet = useMemo(() => {
    const s = new Set<number>();
    for (const [a, b] of gap.runs) for (let i = a; i <= b; i++) s.add(i);
    return s;
  }, [gap.runs]);

  const when = gap.runs
    .filter(([a, b]) => b - a >= 3) // runs shorter than an hour aren't worth naming
    .slice(0, 3)
    .map(([a, b]) => `${slotToTime(a)}–${slotToTime(Math.min(b + 1, SLOTS_PER_DAY - 1))}`)
    .join(", ");

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Link href={`/today?date=${gap.date}`} className="w-28 shrink-0 text-sm font-medium hover:text-accent">
        {gap.date}
      </Link>
      <div className="flex h-4 min-w-40 flex-1 overflow-hidden rounded" title={`${gap.filled}/96 logged`}>
        {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
          <span
            key={s}
            className="h-full flex-1"
            style={{ background: missingSet.has(s) ? "var(--surface-2)" : "var(--accent)", minWidth: 0 }}
          />
        ))}
      </div>
      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted">
        {(gap.missing / 4).toFixed(1)}h
      </span>
      {when && <span className="w-full text-xs text-faint sm:w-auto">{when}</span>}
    </div>
  );
}
