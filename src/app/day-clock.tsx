"use client";

/**
 * The day as a clock.
 *
 * A 96-slot day is exactly 2 rings x 12 hours x 4 quarters, so the data model
 * lands on a clock face with nothing left over:
 *
 *   inner ring   00:00 - 11:59   night into morning, drawn darker
 *   outer ring   12:00 - 23:59   afternoon and evening, drawn lighter
 *
 * The hour numbers live permanently around the rim, which is the fix for "the
 * time disappears once there are words in the cell" — the time is no longer
 * *in* the cell, so a label can never displace it.
 *
 * Drag to paint. Pointer events are tracked on the SVG rather than per-segment
 * because onPointerEnter does not fire for touch drags; hit-testing through
 * elementFromPoint is the only thing that works on a phone and on a desktop.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { categoryColor, categoryName, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";

export interface ClockSlot {
  category: number;
  label?: string | null;
  /** aggregate mode: "62% of days" etc. */
  hint?: string | null;
}

const SIZE = 440;
const C = SIZE / 2;
/**
 * The two rings are visually separated: a clear gap between AM and PM, plus a
 * fine "dawn/dusk" ring in the gap. Without it, 23:45 and 00:00 sit as
 * neighbouring wedges on the SAME ring and read like a single 24-slot spiral,
 * which is what you noticed. They are two different days of the same clock,
 * and the layout should say so.
 */
const INNER = { r0: 62, r1: 118 };
const GAP = 20;
const OUTER = { r0: INNER.r1 + GAP, r1: INNER.r1 + GAP + 82 };
const LABEL_R = OUTER.r1 + 22;   /** outside the outer ring, always. */
const INNER_LABEL_R = INNER.r0 - 22; /** inside the inner ring, always. */
/** hair-thin ring at noon/midnight for the AM->PM handover */
const NOON_TICK_R = INNER.r1 + GAP / 2;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/** One quarter-hour wedge. */
function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

/**
 * slot -> which ring, and the angles it occupies.
 *
 * The -15 offset makes each hour's band CENTRED on its clock position, so 12
 * sits at the top and 3 at the right exactly as on a real dial. Without it the
 * band for 12 runs from the top clockwise and the whole face reads rotated.
 */
const HOUR_OFFSET = -15;

function geom(slot: number) {
  const hour = Math.floor(slot / 4);
  const q = slot % 4;
  const pm = hour >= 12;
  const ring = pm ? OUTER : INNER;
  const a0 = (hour % 12) * 30 + q * 7.5 + HOUR_OFFSET;
  return { ring, a0, a1: a0 + 7.5, pm };
}

export default function DayClock({
  slots,
  onSelect,
  onPaint,
  title,
  subtitle,
  activeCategory,
}: {
  slots: Map<number, ClockSlot>;
  /** fires as soon as a drag ends -- range only, no writes yet */
  onSelect?: (from: number, to: number) => void;
  /** kept for programmatic paint (e.g. arrow keys); no longer wired to drag */
  onPaint?: (from: number, to: number) => void;
  title?: string;
  subtitle?: string;
  activeCategory?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const dragging = anchor !== null;

  const slotAt = useCallback((clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const raw = el?.getAttribute?.("data-slot");
    return raw == null ? null : Number(raw);
  }, []);

  const inSelection = useCallback(
    (s: number) => {
      if (dragging && anchor !== null && cursor !== null) {
        return s >= Math.min(anchor, cursor) && s <= Math.max(anchor, cursor);
      }
      if (selection) return s >= selection[0] && s <= selection[1];
      return false;
    },
    [dragging, anchor, cursor, selection]
  );

  /**
   * Runs of one category, so a two-hour block gets ONE label rather than eight
   * copies of the same word stacked on top of each other.
   */
  const runs = useMemo(() => {
    const out: Array<{ from: number; to: number; cat: number; label: string | null }> = [];
    let cur: (typeof out)[0] | null = null;
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      const v = slots.get(s);
      // a run must not straddle the AM/PM boundary: the two halves are
      // different rings, so one label cannot span them
      const sameRing = !!cur && Math.floor(cur.to / 4) < 12 === Math.floor(s / 4) < 12;
      if (v && cur && v.category === cur.cat && (v.label ?? null) === cur.label && s === cur.to + 1 && sameRing) {
        cur.to = s;
      } else {
        if (cur) out.push(cur);
        cur = v ? { from: s, to: s, cat: v.category, label: v.label ?? null } : null;
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [slots]);

  const readout = hover ?? cursor ?? null;
  const readoutSlot = readout == null ? null : slots.get(readout);

  return (
    <div className="card p-3">
      {(title || subtitle) && (
        <div className="mb-1 text-center">
          {title && <p className="font-semibold">{title}</p>}
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block w-full max-w-[460px] touch-none select-none"
        onPointerDown={(e) => {
          if (!onSelect && !onPaint) return;
          const s = slotAt(e.clientX, e.clientY);
          if (s === null) return;
          (e.target as Element).releasePointerCapture?.(e.pointerId);
          setAnchor(s);
          setCursor(s);
        }}
        onPointerMove={(e) => {
          const s = slotAt(e.clientX, e.clientY);
          setHover(s);
          if (dragging && s !== null) setCursor(s);
        }}
        onPointerUp={() => {
          // Drag SELECTS a range. The parent's "Fill" button commits it.
          // Instant-fill on release was destructive and undoable only by
          // Clear -- one over-drag and you had painted six hours of Sleep.
          if (anchor !== null && cursor !== null) {
            const a = Math.min(anchor, cursor);
            const b = Math.max(anchor, cursor);
            setSelection([a, b]);
            onSelect?.(a, b);
          }
          setAnchor(null);
          setCursor(null);
        }}
        onPointerLeave={() => {
          setHover(null);
          if (dragging) {
            // let go OFF the ring, keep the range you had built up rather
            // than dropping it silently
            if (anchor !== null && cursor !== null) {
              const a = Math.min(anchor, cursor);
              const b = Math.max(anchor, cursor);
              setSelection([a, b]);
              onSelect?.(a, b);
            }
            setAnchor(null);
            setCursor(null);
          }
        }}
      >
        {/* ring backgrounds, so empty time still reads as time */}
        <circle cx={C} cy={C} r={(INNER.r0 + INNER.r1) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={INNER.r1 - INNER.r0} />
        <circle cx={C} cy={C} r={(OUTER.r0 + OUTER.r1) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={OUTER.r1 - OUTER.r0} opacity={0.55} />
        {/* The AM/PM seam is a SOLID band between the two rings, in the
            page colour, so no wedge on the inner touches any wedge on the
            outer. Wispy dashed lines were not enough. */}
        <circle cx={C} cy={C} r={NOON_TICK_R} fill="none" stroke="var(--page)" strokeWidth={GAP - 2} />
        {/* each ring gets its OWN outline so you see the ring itself */}
        <circle cx={C} cy={C} r={INNER.r1 + 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
        <circle cx={C} cy={C} r={OUTER.r0 - 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
        <circle cx={C} cy={C} r={INNER.r0 - 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
        <circle cx={C} cy={C} r={OUTER.r1 + 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
        {/* AM / PM labels in the seam itself, no more ambiguous ◐ */}
        <text x={C} y={C - NOON_TICK_R + 1} textAnchor="middle" dominantBaseline="central" className="fill-faint" style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em" }}>·PM·</text>
        <text x={C} y={C + NOON_TICK_R + 1} textAnchor="middle" dominantBaseline="central" className="fill-faint" style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em" }}>·PM·</text>

        {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
          const { ring, a0, a1, pm } = geom(s);
          const v = slots.get(s);
          const sel = inSelection(s);
          const fill = sel
            ? activeCategory != null
              ? categoryColor(activeCategory)
              : "var(--accent)"
            : v
              ? categoryColor(v.category)
              : "transparent";
          return (
            <path
              key={s}
              data-slot={s}
              d={wedge(ring.r0, ring.r1, a0, a1)}
              fill={fill}
              // the inner ring is night: darken it so the two halves of the day
              // are legible before you read a single number
              // PM sits closer to full colour; AM is a shade lighter so the two
              // halves are legible before you read a single number
              opacity={fill === "transparent" ? 0 : pm ? 1 : 0.72}
              stroke="var(--page)"
              strokeWidth={0.6}
              style={{ cursor: onSelect || onPaint ? "crosshair" : "default" }}
            />
          );
        })}

        {/* Outer ring numbers (PM), around the rim -- always visible. */}
        {Array.from({ length: 12 }, (_, h) => {
          const [x, y] = polar(LABEL_R, h * 30);
          return (
            <text
              key={`pm-${h}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              {h === 0 ? "12" : h}
            </text>
          );
        })}
        {/* Inner ring numbers (AM), inside the inner ring. Same layout. The
            old version had numbers only on the outside so the AM ring read
            as unlabelled and the numbers that WERE there looked wrong -- 12
            was next to a slot that turned out to be PM. */}
        {Array.from({ length: 12 }, (_, h) => {
          const [x, y] = polar(INNER_LABEL_R, h * 30);
          return (
            <text
              key={`am-${h}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-faint"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {h === 0 ? "12" : h}
            </text>
          );
        })}

        {/* one label per run, only where there is room for it */}
        {runs
          .filter((r) => r.label && r.to - r.from >= 3)
          .map((r) => {
            const { ring } = geom(r.from);
            const a = (geom(r.from).a0 + geom(r.to).a1) / 2;
            const [x, y] = polar((ring.r0 + ring.r1) / 2, a);
            const rot = a > 180 ? a + 90 : a - 90;
            return (
              <text
                key={`${r.from}-${r.to}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${rot} ${x} ${y})`}
                style={{ fontSize: 10, fontWeight: 600, pointerEvents: "none", fill: "#fff", paintOrder: "stroke" }}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={2}
              >
                {r.label!.length > 14 ? r.label!.slice(0, 13) + "…" : r.label}
              </text>
            );
          })}

        {/* centre readout */}
        <circle cx={C} cy={C} r={INNER.r0 - 6} fill="var(--surface)" />
        {readout != null ? (
          <>
            <text x={C} y={C - 16} textAnchor="middle" className="fill-ink" style={{ fontSize: 19, fontWeight: 700 }}>
              {slotToTime(readout)}
            </text>
            <text x={C} y={C + 6} textAnchor="middle" className="fill-muted" style={{ fontSize: 12 }}>
              {readoutSlot ? categoryName(readoutSlot.category) : "not logged"}
            </text>
            {readoutSlot?.label && (
              <text x={C} y={C + 24} textAnchor="middle" className="fill-faint" style={{ fontSize: 11 }}>
                {readoutSlot.label.length > 18 ? readoutSlot.label.slice(0, 17) + "…" : readoutSlot.label}
              </text>
            )}
            {readoutSlot?.hint && (
              <text x={C} y={C + 24} textAnchor="middle" className="fill-faint" style={{ fontSize: 11 }}>
                {readoutSlot.hint}
              </text>
            )}
          </>
        ) : (
          <>
            <text x={C} y={C - 10} textAnchor="middle" className="fill-faint" style={{ fontSize: 11, fontWeight: 600 }}>
              AM inside
            </text>
            <text x={C} y={C + 8} textAnchor="middle" className="fill-faint" style={{ fontSize: 11, fontWeight: 600 }}>
              PM outside
            </text>
            {onPaint && (
              <text x={C} y={C + 28} textAnchor="middle" className="fill-faint" style={{ fontSize: 10 }}>
                drag to fill
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
