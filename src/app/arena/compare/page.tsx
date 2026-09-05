"use client";

/**
 * Side by side: everyone's day as full 96-slot columns for a chosen date.
 * Includes you and anyone whose full day detail you're allowed to see
 * (the legends + friends sharing raw labels). Hover a block for the activity.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchLeaderboard, fetchMemberDayStrip, type DayStripRow } from "@/lib/friends";
import { createClient } from "@/lib/supabase/client";

interface PersonDays {
  id: string;
  name: string;
  isDemo: boolean;
  byDate: Map<string, Map<number, { category: number; label: string | null }>>;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ArenaComparePage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayISO);
  const [people, setPeople] = useState<PersonDays[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        const me = data.user?.id ?? null;
        const board = await fetchLeaderboard();
        const ids = new Map<string, { name: string; isDemo: boolean }>();
        for (const r of board) ids.set(r.memberId, { name: r.displayName, isDemo: r.isDemo });
        if (me && !ids.has(me)) ids.set(me, { name: "You", isDemo: false });
        const out: PersonDays[] = [];
        const noAccess: string[] = [];
        await Promise.all(
          [...ids.entries()].slice(0, 10).map(async ([id, info]) => {
            try {
              const strip: DayStripRow[] = await fetchMemberDayStrip(id);
              const byDate = new Map<string, Map<number, { category: number; label: string | null }>>();
              for (const r of strip) {
                if (!byDate.has(r.date)) byDate.set(r.date, new Map());
                byDate.get(r.date)!.set(r.slot, { category: r.category, label: r.label });
              }
              out.push({ id, name: id === me ? `${info.name} (you)` : info.name, isDemo: info.isDemo, byDate });
            } catch {
              noAccess.push(info.name); // totals-only friends: no day detail
            }
          })
        );
        out.sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
        setPeople(out);
        setSkipped(noAccess);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const columns = useMemo(
    () =>
      people
        .map((p) => ({ ...p, day: p.byDate.get(date) ?? null }))
        .filter((p) => p.day !== null || p.isDemo),
    [people, date]
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Side by side</h1>
        <button onClick={() => setDate(addDays(date, -1))} className="rounded-lg border px-2.5 py-1 text-sm">←</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm" />
        <button onClick={() => setDate(addDays(date, 1))} disabled={date >= todayISO} className="rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40">→</button>
        <Link href="/arena" className="ml-auto text-sm font-medium text-accent hover:underline">← Back to the Arena</Link>
      </div>
      <p className="mb-3 text-sm text-muted">
        Whole days, hour by hour. Hover any block to see the activity. Only people who share full day detail appear
        {skipped.length > 0 && <> — {skipped.join(", ")} share totals only</>}.
      </p>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {CATEGORIES.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading days…</p>
      ) : columns.length === 0 ? (
        <p className="card p-4 text-sm text-faint">Nothing to show for {date}.</p>
      ) : (
        <div className="card overflow-x-auto p-4">
          <div className="flex gap-6">
            {/* time ruler */}
            <div className="relative w-10 shrink-0" style={{ height: 576 }}>
              {[0, 6, 12, 18, 24].map((h) => (
                <span key={h} className="absolute right-0 -translate-y-1/2 font-mono text-[10px] text-faint" style={{ top: (h / 24) * 576 }}>
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {columns.map((p) => (
              <div key={p.id} className="flex w-28 shrink-0 flex-col items-center">
                <Link href={`/friends/${p.id}`} className="mb-2 max-w-full truncate text-sm font-semibold hover:text-accent hover:underline">
                  {p.name}
                </Link>
                <div className="flex w-full flex-col overflow-hidden rounded-lg border" style={{ height: 576 }}>
                  {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
                    const c = p.day?.get(s);
                    return (
                      <div
                        key={s}
                        title={`${p.name} — ${slotToTime(s)}${c ? `: ${categoryName(c.category)}${c.label ? ` (${c.label})` : ""}` : ""}`}
                        className="w-full flex-1 overflow-hidden whitespace-nowrap"
                        style={{ background: c ? categoryColor(c.category) : "var(--surface-2)" }}
                      >
                        {c?.label && s % 4 === 0 ? (
                          <span className="block truncate px-1 text-[8px] font-medium leading-[6px] text-white/90">{c.label}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <span className="mt-1 text-[10px] text-faint">
                  {p.day ? `${p.day.size}/96 logged` : "nothing logged"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
