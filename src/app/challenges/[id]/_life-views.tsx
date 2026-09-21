"use client";

/**
 * Life-challenge visualisations: the two views that only make sense
 * when everyone's underlying data is the 15-minute day grid.
 *
 *   AverageDayClock     One big DayClock showing the modal category
 *                       per slot across every member x every day in
 *                       the challenge window. "What does the group's
 *                       typical day look like?"
 *
 *   MembersDayColumns   Each member as a vertical 24-hour column, 96
 *                       stripes stacked top (00:00) to bottom (23:59)
 *                       coloured by their modal category at that
 *                       slot. Side-by-side across the group so you
 *                       can eyeball who's the early bird, who's the
 *                       night owl, who's grinding evenings.
 *
 * Both share the same "fetch every member's day strip within the
 * challenge window" scaffolding, extracted into a hook that only
 * runs when the member list actually changes.
 */

import { useEffect, useMemo, useState } from "react";
import DayClock, { type ClockSlot } from "../../day-clock";
import type { DayStripRow } from "@/lib/friends";
import { categoryColor, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";

type Member = { id: string; name: string };

/**
 * Fetch each member's day-strip rows for the [from, to] window.
 * cached-rpc'd upstream, so the same challenge page can call this
 * multiple times cheaply.
 */
function useMemberStrips(members: Member[], from?: string, to?: string) {
  const [strips, setStrips] = useState<Map<string, DayStripRow[]>>(new Map());
  const [loaded, setLoaded] = useState(false);
  // memoise the id list so the effect doesn't refire on every parent
  // render just because a new array literal came in.
  const key = members.map((m) => m.id).join(",") + `|${from ?? ""}|${to ?? ""}`;
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      const { fetchMemberDayStrip } = await import("@/lib/friends");
      const results = await Promise.all(
        members.map(async (m) => {
          try {
            const rs = await fetchMemberDayStrip(m.id, from, to);
            return [m.id, rs] as const;
          } catch {
            return [m.id, [] as DayStripRow[]] as const;
          }
        })
      );
      if (!alive) return;
      setStrips(new Map(results));
      setLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { strips, loaded };
}

/**
 * "What does the group's typical day look like?" — one dial, computed
 * from every day every member has logged inside the challenge window.
 * A slot's colour is the category picked by the plurality of
 * (member, day) pairs there. Ties break on whichever appeared first.
 *
 * A member who hasn't logged anything simply doesn't contribute, so
 * the average tilts toward the people who ARE showing up rather than
 * grinding to zero when someone hasn't opened the app.
 */
export function AverageDayClock({
  members,
  from,
  to,
  title,
  subtitle,
}: {
  members: Member[];
  from?: string;
  to?: string;
  title?: string;
  subtitle?: string;
}) {
  const { strips, loaded } = useMemberStrips(members, from, to);

  const clockSlots = useMemo(() => {
    // slot -> (category -> count) across everyone x every day
    const perSlot = new Map<number, Map<number, number>>();
    for (const rows of strips.values()) {
      for (const r of rows) {
        if (!perSlot.has(r.slot)) perSlot.set(r.slot, new Map());
        const mm = perSlot.get(r.slot)!;
        mm.set(r.category, (mm.get(r.category) ?? 0) + 1);
      }
    }
    const out = new Map<number, ClockSlot>();
    for (const [slot, counts] of perSlot) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) out.set(slot, { category: top[0] });
    }
    return out;
  }, [strips]);

  const hasAny = clockSlots.size > 0;

  return (
    <section>
      <h2 className="mb-2 font-semibold">{title ?? "The group's average day"}</h2>
      {subtitle && <p className="mb-2 text-sm text-muted">{subtitle}</p>}
      {!loaded ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : !hasAny ? (
        <p className="text-sm text-faint">
          Nothing logged yet by anyone in the challenge window — the average kicks in as soon as one person starts.
        </p>
      ) : (
        // Feedback: the previous 720 px was way too tall on the
        // challenge page; halved to ~360 so it fits without dwarfing
        // everything below it.
        <DayClock slots={clockSlots} maxWidth={360} />
      )}
    </section>
  );
}

/**
 * Side-by-side 24-hour columns, one per member. Each column is a
 * vertical stack of 96 stripes coloured by that member's modal
 * category at each slot (00:00 at the top, 23:59 at the bottom).
 *
 * The scale runs down each column so time is comparable across
 * members at a glance -- the row a stripe sits on IS its time of
 * day. Hour tick marks on the left of the container give a spatial
 * key without cluttering each column with numbers.
 */
export function MembersDayColumns({
  members,
  from,
  to,
}: {
  members: Member[];
  from?: string;
  to?: string;
}) {
  const { strips, loaded } = useMemberStrips(members, from, to);
  // How tall each stripe is. 96 stripes at 3 px each = 288 px total.
  // Halved from 6 px on feedback that the columns dwarfed everything
  // else on the challenge page. Still tall enough to read the daily
  // rhythm; individual quarter-hours become a hint rather than a
  // distinct band, which is the right level of detail for "when do
  // these people live?".
  const STRIPE_H = 3;
  const totalH = STRIPE_H * SLOTS_PER_DAY;
  const COL_W = 34;

  const withData = useMemo(
    () =>
      members
        .map((m) => {
          const rows = strips.get(m.id) ?? [];
          const perSlot = new Map<number, Map<number, number>>();
          for (const r of rows) {
            if (!perSlot.has(r.slot)) perSlot.set(r.slot, new Map());
            const mm = perSlot.get(r.slot)!;
            mm.set(r.category, (mm.get(r.category) ?? 0) + 1);
          }
          const clock = new Map<number, number>();
          for (const [slot, counts] of perSlot) {
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            if (top) clock.set(slot, top[0]);
          }
          const days = new Set(rows.map((r) => r.date)).size;
          return { ...m, clock, days };
        })
        .filter((m) => m.clock.size > 0),
    [members, strips]
  );

  if (!loaded) return <p className="text-sm text-faint">Loading…</p>;
  if (withData.length === 0)
    return (
      <p className="text-sm text-faint">
        Nothing logged yet — the columns fill in as members start posting their days.
      </p>
    );

  // Every 6 hours gets a labelled tick so the eye can find dawn /
  // noon / dusk / midnight without counting stripes.
  const TICKS = [0, 24, 48, 72]; // slot indices for 00, 06, 12, 18
  // How wide the card actually needs to be: axis column + N columns
  // + gaps + padding. Prevents the card from stretching to the full
  // 85% carousel-slide width and leaving huge empty space to the
  // right of a handful of members.
  const AXIS_W = 32;
  const GAP = 8; // matches gap-2
  const contentW = AXIS_W + withData.length * (COL_W + GAP) + 16;
  return (
    <div className="card mx-auto p-3" style={{ maxWidth: `${contentW}px` }}>
      <div className="mb-2 flex items-baseline justify-between text-xs text-muted">
        <span>00:00 up top, 23:45 at the bottom.</span>
        <span className="text-faint">{withData.length} {withData.length === 1 ? "person" : "people"}</span>
      </div>
      <div className="-mx-3 overflow-x-auto px-3">
        <div className="flex items-start gap-2" style={{ minHeight: totalH + 24 }}>
          {/* Left-side time axis */}
          <div className="relative shrink-0 pr-1 pt-2 text-[10px] tabular-nums text-faint" style={{ height: totalH, width: 32 }}>
            {TICKS.map((s) => (
              <span
                key={s}
                className="absolute right-1"
                style={{ top: s * STRIPE_H - 6 }}
              >
                {slotToTime(s)}
              </span>
            ))}
          </div>
          {/* Member columns */}
          {withData.map((m) => (
            <div key={m.id} className="shrink-0" style={{ width: COL_W }}>
              <div
                className="relative overflow-hidden rounded-md border"
                style={{ width: COL_W, height: totalH, background: "var(--surface-2)" }}
                title={`${m.name} · ${m.days} day${m.days === 1 ? "" : "s"} logged`}
              >
                {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
                  const cat = m.clock.get(s);
                  if (cat == null) return null;
                  return (
                    <div
                      key={s}
                      style={{
                        position: "absolute",
                        top: s * STRIPE_H,
                        left: 0,
                        right: 0,
                        height: STRIPE_H,
                        background: categoryColor(cat),
                      }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 max-w-[60px] truncate text-center text-[10px] font-medium" title={m.name}>
                {m.name.split(/\s+/)[0]}
              </p>
              <p className="text-center text-[9px] text-faint">{m.days}d</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
