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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DayClock, { type ClockSlot } from "../../day-clock";
import type { DayStripRow } from "@/lib/friends";
import {
  CATEGORIES,
  categoryColor,
  categoryName,
  defaultBuckets,
  HOURS_PER_SLOT,
  slotToTime,
  SLOTS_PER_DAY,
  type Bucket,
} from "@/lib/categories";

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
  // Bit of breathing room above and below the columns so the 00:00
  // and 23:45 stripes aren't glued to the card edge -- reported as
  // "needs a bit more headroom" in the last screenshot.
  const PAD_Y = 8;
  // Hover state for the custom tooltip. Native title tooltips were
  // showing a "?" cursor without the actual text on the user's
  // browser, so we render our own overlay pinned to the column.
  const [hover, setHover] = useState<
    { memberId: string; slot: number; x: number; y: number } | null
  >(null);

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
          // Per slot: which category won, how many days for that
          // category at that slot, total days with anything logged
          // at that slot. Feeds the hover tooltip and the stripe
          // colour.
          const clock = new Map<number, { cat: number; count: number; total: number }>();
          for (const [slot, counts] of perSlot) {
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            const total = [...counts.values()].reduce((s, v) => s + v, 0);
            if (top) clock.set(slot, { cat: top[0], count: top[1], total });
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
  // grid-cell width and leaving huge empty space to the right of a
  // handful of members.
  const AXIS_W = 32;
  const GAP = 8; // matches gap-2
  const contentW = AXIS_W + withData.length * (COL_W + GAP) + 16;
  // Custom tooltip content -- memberised by hover state.
  const hoveredMember = hover ? withData.find((m) => m.id === hover.memberId) : null;
  const hoveredCell = hover && hoveredMember ? hoveredMember.clock.get(hover.slot) : null;

  return (
    <div className="card p-3" style={{ maxWidth: `${contentW}px` }}>
      {/* Redundant '00:00 up top / N people' caption killed on
          feedback -- the axis on the left already labels the times
          and each column has a name under it. */}
      <div
        className="relative -mx-3 overflow-x-auto px-3"
        onMouseLeave={() => setHover(null)}
      >
        <div className="flex items-start gap-2" style={{ minHeight: totalH + 2 * PAD_Y + 24 }}>
          {/* Left-side time axis */}
          <div
            className="relative shrink-0 pr-1 text-[10px] tabular-nums text-faint"
            style={{ height: totalH + 2 * PAD_Y, width: 32, paddingTop: PAD_Y }}
          >
            {TICKS.map((s) => (
              <span
                key={s}
                className="absolute right-1"
                style={{ top: PAD_Y + s * STRIPE_H - 6 }}
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
                style={{
                  width: COL_W,
                  height: totalH + 2 * PAD_Y,
                  background: "var(--surface-2)",
                  paddingTop: PAD_Y,
                  paddingBottom: PAD_Y,
                  boxSizing: "border-box",
                }}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top - PAD_Y;
                  const slot = Math.max(0, Math.min(SLOTS_PER_DAY - 1, Math.floor(y / STRIPE_H)));
                  setHover({ memberId: m.id, slot, x: rect.left + rect.width / 2, y: rect.top });
                }}
              >
                {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
                  const cell = m.clock.get(s);
                  if (!cell) return null;
                  return (
                    <div
                      key={s}
                      style={{
                        position: "absolute",
                        top: PAD_Y + s * STRIPE_H,
                        left: 0,
                        right: 0,
                        height: STRIPE_H,
                        background: categoryColor(cell.cat),
                      }}
                    />
                  );
                })}
                {/* Highlight the hovered slot so the tooltip has a
                    visible anchor even on unlogged stripes. */}
                {hover?.memberId === m.id && (
                  <div
                    style={{
                      position: "absolute",
                      top: PAD_Y + hover.slot * STRIPE_H - 1,
                      left: -1,
                      right: -1,
                      height: STRIPE_H + 2,
                      border: "1px solid var(--accent)",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
              <p className="mt-1 max-w-[60px] truncate text-center text-[10px] font-medium" title={m.name}>
                {m.name.split(/\s+/)[0]}
              </p>
              <p className="text-center text-[9px] text-faint">{m.days}d</p>
            </div>
          ))}
        </div>

        {/* Custom hover tooltip. Uses fixed positioning off the
            hover coords so it sits above the column and doesn't get
            clipped by the horizontally-scrolling wrapper. */}
        {hover && hoveredMember && (
          <div
            className="pointer-events-none fixed z-50 rounded-lg border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: hover.x,
              top: hover.y - 6,
              transform: "translate(-50%, -100%)",
              whiteSpace: "nowrap",
              maxWidth: 260,
            }}
          >
            <div className="font-semibold">
              {hoveredMember.name} · <span className="tabular-nums text-muted">{slotToTime(hover.slot)}</span>
            </div>
            {hoveredCell ? (
              <div className="text-muted">
                {categoryName(hoveredCell.cat)}
                {hoveredCell.total > 1 && (
                  <span className="ml-1 text-faint">
                    · {hoveredCell.count}/{hoveredCell.total} days
                    ({Math.round((hoveredCell.count / hoveredCell.total) * 100)}%)
                  </span>
                )}
              </div>
            ) : (
              <div className="text-faint">not logged</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hours-per-person bucket totals: three clustered bars per member --
 * productive, brainrot ("unproductive"), other -- so a viewer can
 * eyeball who's heavy in each bucket without decoding the vertical
 * columns to the left. Uses the same day-strip fetch as the columns
 * chart via the cachedRpcAll on lib/friends, so it doesn't
 * re-request when it renders in the same section as MembersDayColumns.
 *
 * Bucketing follows the app's default (Work + Sports = productive,
 * Other + Leisure = brainrot, everything else = other). Bucket
 * personalisation isn't per-viewer here because a challenge is a
 * shared board -- everyone sees the same numbers.
 */
export function MembersHoursBars({
  members,
  from,
  to,
  maxWidth = 360,
}: {
  members: Member[];
  from?: string;
  to?: string;
  /** CSS max-width for the card. Defaults to 360 so it mirrors the
      Average Day clock size. Data axis scales inside. */
  maxWidth?: number;
}) {
  const { strips, loaded } = useMemberStrips(members, from, to);
  const buckets = defaultBuckets();
  const bucketOf = (cat: number): Bucket | undefined => buckets[cat];

  // Per-person totals across the challenge window ONLY -- the
  // useMemberStrips hook passes from/to straight through to the
  // member_day_strip RPC, which filters server-side. Anything logged
  // outside [from, to] is never returned, so these hours are strictly
  // the challenge window.
  const data = useMemo(
    () =>
      members.map((m) => {
        const rows = strips.get(m.id) ?? [];
        let p = 0, b = 0, o = 0;
        for (const r of rows) {
          const bk = bucketOf(r.category);
          if (bk === "productive") p += HOURS_PER_SLOT;
          else if (bk === "brainrot") b += HOURS_PER_SLOT;
          else o += HOURS_PER_SLOT;
        }
        return {
          name: m.name.split(/\s+/)[0],
          productive: Math.round(p * 10) / 10,
          brainrot: Math.round(b * 10) / 10,
          other: Math.round(o * 10) / 10,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, strips]
  );

  if (!loaded) return <p className="text-sm text-faint">Loading…</p>;
  const any = data.some((d) => d.productive + d.brainrot + d.other > 0);
  if (!any)
    return (
      <p className="text-sm text-faint">
        No hours logged yet by anyone in the window.
      </p>
    );

  // Bucket colours -- keep the productive/brainrot palette that the
  // rest of the app uses, so 'productive' is always the same blue.
  const catByCode = new Map(CATEGORIES.map((c) => [c.code, c]));
  const P = catByCode.get(1)?.color ?? "#2563eb";
  const B = catByCode.get(6)?.color ?? "#ef4444";
  const O = "var(--muted)";

  // Horizontal lollipop: each person contributes three rows
  // (productive, unproductive, other), each row a thin rail with a
  // dot at its right end. Rail length is proportional to hours vs
  // the max value across everything, so the x-axis 'scales to fit'
  // the group's biggest number regardless of challenge length.
  const rows: Array<{
    key: string;
    person: string;
    bucket: "productive" | "unproductive" | "other";
    hours: number;
    color: string;
    firstOfPerson: boolean;
  }> = [];
  for (const d of data) {
    rows.push({ key: `${d.name}-p`, person: d.name, bucket: "productive", hours: d.productive, color: P, firstOfPerson: true });
    rows.push({ key: `${d.name}-b`, person: d.name, bucket: "unproductive", hours: d.brainrot, color: B, firstOfPerson: false });
    rows.push({ key: `${d.name}-o`, person: d.name, bucket: "other", hours: d.other, color: O, firstOfPerson: false });
  }
  const max = Math.max(1, ...rows.map((r) => r.hours));

  return (
    <div className="card p-3" style={{ maxWidth: `${maxWidth}px` }}>
      <div className="mb-2 flex items-center gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: P }} />productive</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: B }} />unproductive</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: O }} />other</span>
        <span className="ml-auto text-faint">0 – {Math.ceil(max)}h</span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const pct = Math.max(1, (r.hours / max) * 100);
          return (
            <div key={r.key} className="grid grid-cols-[56px_1fr_44px] items-center gap-2 text-[11px]">
              <span className={`truncate ${r.firstOfPerson ? "font-semibold text-ink" : "text-faint"}`} title={r.person}>
                {r.firstOfPerson ? r.person : ""}
              </span>
              <div className="relative h-3">
                <div className="absolute inset-y-1/2 left-0 right-0 -translate-y-1/2 border-t border-dashed border-border/60" />
                <div
                  className="absolute inset-y-1/2 left-0 -translate-y-1/2 rounded-full"
                  style={{ width: `${pct}%`, height: 2, background: r.color, opacity: r.hours > 0 ? 1 : 0.2 }}
                />
                <div
                  className="absolute -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-surface"
                  style={{
                    top: "50%",
                    left: `${pct}%`,
                    width: 8,
                    height: 8,
                    background: r.color,
                    opacity: r.hours > 0 ? 1 : 0.3,
                  }}
                />
              </div>
              <span className="tabular-nums text-right text-faint">{r.hours}h</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
