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

/**
 * Two visual modes. Same 96 slots, same hit targets, same drag geometry.
 *
 *   "rings"   two-ring dial (default): AM inside, PM outside, 1-12 numbers
 *             around the RIM only, plus explicit AM/PM label chips on each
 *             ring so the identity of each half is one glance not a guess.
 *   "spiral"  a single unwinding turn; kept for callers that want it but
 *             the wedge is too thin to click reliably at any workable radius,
 *             which is why it is no longer the default.
 */
export type ClockMode = "spiral" | "rings";

/**
 * viewBox size. Grown from 440 to 500 to keep the 1-12 rim numbers INSIDE
 * the SVG -- at 440, the 12 (top) and 6 (bottom) landed at y = -2 and
 * y = 442, both outside the frame and both invisible. The rings inside
 * stay their old size; only the padding grows.
 */
const SIZE = 500;
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

/**
 * The spiral. Every slot occupies a 24th of a full turn on a radius that
 * grows LINEARLY with the slot index, so 23:45 (slot 95) sits at 359deg on
 * the outermost band and 00:00 (slot 0) sits at 0deg on the innermost --
 * exactly one revolution end-to-end.
 *
 * The band width tapers slightly outward so early morning reads a touch
 * chunkier and evening a touch finer, which is the natural way to look at
 * a day laid out this way. Adjust STEP if you want a fatter or thinner
 * spiral.
 */
/**
 * Two turns, not one. AM lives on the inner turn, PM on the outer, so 6am
 * and 6pm are on the same clock position -- exactly the point of a spiral.
 * The band per slot is (SPIRAL_OUTER - SPIRAL_INNER) / 2, which is a THICK,
 * clickable ring. The old "one turn" version made every wedge 1/96 of the
 * ring thick (~1.4 px), which was unhittable and read as a line.
 */
const SPIRAL_INNER = 62;
const SPIRAL_OUTER = 202;
const SPIRAL_TURNS = 2;
/**
 * Two concentric turns: AM (hours 0-11) on the INNER band, PM (hours 12-23)
 * on the OUTER. Each slot occupies a real quarter-hour wedge with two radii,
 * so it's a proper hittable annulus not a hairline.
 *
 * Turn 1 spans SPIRAL_INNER .. mid; turn 2 spans mid .. SPIRAL_OUTER. Both
 * are wide bands (~65 px each here), so 6am and 6pm land on the same clock
 * angle at 3 o'clock -- both are radially clickable and visually paired.
 */
const SPIRAL_MID = (SPIRAL_INNER + SPIRAL_OUTER) / 2;
const SPIRAL_GAP = 4; // tiny visual break between the two turns
function geomSpiral(slot: number) {
  const hour = Math.floor(slot / 4);
  const q = slot % 4;
  const pm = hour >= 12;
  // ring bounds, with a small gap between them
  const r0 = pm ? SPIRAL_MID + SPIRAL_GAP / 2 : SPIRAL_INNER;
  const r1 = pm ? SPIRAL_OUTER : SPIRAL_MID - SPIRAL_GAP / 2;
  // clockwise from the top, one full turn per 12 hours
  const h = hour % 12;
  const a0 = -90 + (h * 60 + q * 15);
  const a1 = a0 + 15;
  return { r0, r1, a0: (a0 + 360) % 360, a1: (a1 + 360) % 360, hour, pm };
}
/**
 * A fat quarter-hour wedge: the annulus between r0 and r1 across a 15° arc.
 * This IS the same shape as `wedge()`, just at spiral coordinates. Having
 * two functions was a mistake -- the old spiralWedge subtracted a band width
 * from the outer radius, which is what made the ring paper-thin.
 */
function spiralWedge(g: ReturnType<typeof geomSpiral>): string {
  return wedge(g.r0, g.r1, g.a0, g.a1);
}

export default function DayClock({
  slots,
  onSelect,
  onPaint,
  title,
  subtitle,
  activeCategory,
  mode = "rings",
}: {
  slots: Map<number, ClockSlot>;
  mode?: ClockMode;
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

  /**
   * Two-tap mode alongside drag: if the pointer goes down and comes up
   * on the SAME slot (no movement), we treat it as a click. First
   * click sets the FROM; second click sets the UNTIL and completes
   * the range. Third click starts a new selection. Any drag that
   * actually moves takes over and clears the pending tap. Timeout
   * keeps a lonely first click from sticking around forever.
   */
  const pendingTapRef = useRef<{ slot: number; at: number } | null>(null);
  const TAP_WINDOW_MS = 8000;
  const downPosRef = useRef<{ slot: number; moved: boolean } | null>(null);

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
          downPosRef.current = { slot: s, moved: false };
        }}
        onPointerMove={(e) => {
          const s = slotAt(e.clientX, e.clientY);
          setHover(s);
          if (dragging && s !== null) {
            setCursor(s);
            if (downPosRef.current && s !== downPosRef.current.slot) {
              downPosRef.current.moved = true;
            }
          }
        }}
        onPointerUp={() => {
          if (anchor !== null && cursor !== null) {
            const wasClick = downPosRef.current && !downPosRef.current.moved;
            const now = Date.now();
            const pending = pendingTapRef.current;

            if (wasClick) {
              // TAP branch. First tap: remember it, show a 1-slot
              // selection so there's feedback. Second tap within the
              // window: commit the [first, second] range and clear.
              if (pending && now - pending.at < TAP_WINDOW_MS && pending.slot !== anchor) {
                const a = Math.min(pending.slot, anchor);
                const b = Math.max(pending.slot, anchor);
                setSelection([a, b]);
                onSelect?.(a, b);
                pendingTapRef.current = null;
              } else {
                // first tap of a pair (or a re-tap on the same slot)
                pendingTapRef.current = { slot: anchor, at: now };
                setSelection([anchor, anchor]);
                onSelect?.(anchor, anchor);
              }
            } else {
              // DRAG branch. Commits the drag range and clears any
              // half-finished tap sequence.
              const a = Math.min(anchor, cursor);
              const b = Math.max(anchor, cursor);
              setSelection([a, b]);
              onSelect?.(a, b);
              pendingTapRef.current = null;
            }
          }
          setAnchor(null);
          setCursor(null);
          downPosRef.current = null;
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
              pendingTapRef.current = null;
            }
            setAnchor(null);
            setCursor(null);
            downPosRef.current = null;
          }
        }}
      >
        {/* ring backgrounds, so empty time still reads as time */}
        {mode === "rings" && (
          <>
            <circle cx={C} cy={C} r={(INNER.r0 + INNER.r1) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={INNER.r1 - INNER.r0} />
            <circle cx={C} cy={C} r={(OUTER.r0 + OUTER.r1) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={OUTER.r1 - OUTER.r0} opacity={0.55} />
          </>
        )}
        {/* The AM/PM seam is a SOLID band between the two rings, in the
            page colour, so no wedge on the inner touches any wedge on the
            outer. Wispy dashed lines were not enough. */}
        {mode === "rings" && <circle cx={C} cy={C} r={NOON_TICK_R} fill="none" stroke="var(--page)" strokeWidth={GAP - 2} />}
        {/* each ring gets its OWN outline so you see the ring itself */}
        {mode === "rings" && (
          <>
            <circle cx={C} cy={C} r={INNER.r1 + 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
            <circle cx={C} cy={C} r={OUTER.r0 - 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
            <circle cx={C} cy={C} r={INNER.r0 - 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
            <circle cx={C} cy={C} r={OUTER.r1 + 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
            {/* AM/PM chips sit ON their own ring's body at the 9-o'clock
                position. Previous version put PM at OUTER.r1 + 22 which
                clipped off the left of the viewBox; the "outside the
                circle" language reads better when the label ends up ON
                the ring rather than beyond it, and there's no crowding
                with the rim numbers. Contrast against the empty-track
                fill is enough at fontWeight 800. */}
            <text
              x={C - (OUTER.r0 + OUTER.r1) / 2}
              y={C}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted"
              style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em" }}
            >
              PM
            </text>
            <text
              x={C - (INNER.r0 + INNER.r1) / 2}
              y={C}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted"
              style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em" }}
            >
              AM
            </text>
          </>
        )}

        {/* base fill layer (rings mode). Spiral mode renders below. */}
        {mode === "rings" && Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
          const { ring, a0, a1, pm } = geom(s);
          const v = slots.get(s);
          const fill = v ? categoryColor(v.category) : "transparent";
          return (
            <path
              key={`base-${s}`}
              data-slot={s}
              d={wedge(ring.r0, ring.r1, a0, a1)}
              fill={fill}
              opacity={fill === "transparent" ? 0 : pm ? 1 : 0.72}
              stroke="var(--page)"
              strokeWidth={0.6}
              style={{ cursor: onSelect || onPaint ? "crosshair" : "default" }}
            />
          );
        })}

        {/* Selection overlay (rings). */}
        {mode === "rings" && Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
          if (!inSelection(s)) return null;
          const { ring, a0, a1 } = geom(s);
          const tint = activeCategory != null ? categoryColor(activeCategory) : "var(--accent)";
          return (
            <g key={`sel-${s}`} pointerEvents="none">
              <path d={wedge(ring.r0, ring.r1, a0, a1)} fill={tint} opacity={0.9} />
              <path d={wedge(ring.r0, ring.r1, a0, a1)} fill="none" stroke="#fff" strokeWidth={1} opacity={0.7} />
            </g>
          );
        })}

        {/* SPIRAL mode -- base track + fills + selection, in one loop.
            The subtle 12-marker outline is a background hint of a clock. */}
        {mode === "spiral" && (
          <g>
            {/* two solid track rings behind the wedges, so an empty day still
                shows a proper clock face. Otherwise the spiral looks like
                nothing until you have data. */}
            <circle cx={C} cy={C} r={(SPIRAL_INNER + SPIRAL_MID - SPIRAL_GAP / 2) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={(SPIRAL_MID - SPIRAL_GAP / 2) - SPIRAL_INNER} />
            <circle cx={C} cy={C} r={(SPIRAL_MID + SPIRAL_GAP / 2 + SPIRAL_OUTER) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={SPIRAL_OUTER - (SPIRAL_MID + SPIRAL_GAP / 2)} opacity={0.6} />
            {/* per-slot base (transparent so tracks show through, but IT is
                the hit target -- one path per data-slot for elementFromPoint) */}
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
              const g = geomSpiral(s);
              return (
                <path
                  key={`bg-${s}`}
                  data-slot={s}
                  d={spiralWedge(g)}
                  fill="transparent"
                  stroke="var(--page)"
                  strokeWidth={0.6}
                  style={{ cursor: onSelect || onPaint ? "crosshair" : "default" }}
                />
              );
            })}
            {/* filled slots */}
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
              const v = slots.get(s);
              if (!v) return null;
              const g = geomSpiral(s);
              return (
                <path
                  key={`fill-${s}`}
                  d={spiralWedge(g)}
                  fill={categoryColor(v.category)}
                  opacity={0.95}
                  pointerEvents="none"
                />
              );
            })}
            {/* selection overlay + heavy frame around the whole run */}
            {Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
              if (!inSelection(s)) return null;
              const g = geomSpiral(s);
              const tint = activeCategory != null ? categoryColor(activeCategory) : "var(--accent)";
              return (
                <g key={`sel-${s}`} pointerEvents="none">
                  <path d={spiralWedge(g)} fill={tint} opacity={0.9} />
                  <path d={spiralWedge(g)} fill="none" stroke="#fff" strokeWidth={0.8} opacity={0.5} />
                </g>
              );
            })}
            {/* selection frame: outlined single path across the whole
                selected arc so it reads as one picked block */}
            {(dragging || selection) &&
              (() => {
                const r = dragging && anchor !== null && cursor !== null
                  ? [Math.min(anchor, cursor), Math.max(anchor, cursor)] as const
                  : selection!;
                const first = geomSpiral(r[0]);
                const last = geomSpiral(r[1]);
                const bandW = (SPIRAL_OUTER - SPIRAL_INNER) / SLOTS_PER_DAY;
                // outline the growing band: two spirals joined at each end
                const [x0, y0] = polar(first.r0, first.a0);
                const [x1, y1] = polar(last.r1, last.a1);
                const [x2, y2] = polar(last.r1 - bandW, last.a1);
                const [x3, y3] = polar(first.r0 - bandW, first.a0);
                const spans = (r[1] - r[0]) / SLOTS_PER_DAY * 360;
                const large = spans > 180 ? 1 : 0;
                const outer = `M${x0},${y0} A${first.r0},${first.r0} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${first.r0},${first.r0} 0 ${large} 0 ${x3},${y3} Z`;
                return <path d={outer} fill="none" stroke="var(--ink)" strokeWidth={2.5} pointerEvents="none" />;
              })()}
          </g>
        )}

        {/* rings mode: heavy outline around each per-ring chunk */}
        {mode === "rings" && (() => {
          if (dragging || selection) {
            const range = dragging && anchor !== null && cursor !== null
              ? [Math.min(anchor, cursor), Math.max(anchor, cursor)] as const
              : selection!;
            // split the range into per-ring runs, since one selection can span
            // both rings and each needs its own outline
            const chunks: Array<{ ring: typeof INNER; a0: number; a1: number }> = [];
            let curChunk: { ring: typeof INNER; a0: number; a1: number } | null = null;
            for (let s = range[0]; s <= range[1]; s++) {
              const g = geom(s);
              if (curChunk && curChunk.ring === g.ring) {
                curChunk.a1 = g.a1;
              } else {
                if (curChunk) chunks.push(curChunk);
                curChunk = { ring: g.ring, a0: g.a0, a1: g.a1 };
              }
            }
            if (curChunk) chunks.push(curChunk);
            return chunks.map((c, i) => (
              <path
                key={`frame-${i}`}
                d={wedge(c.ring.r0, c.ring.r1, c.a0, c.a1)}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={2.5}
                pointerEvents="none"
              />
            ));
          }
          return null;
        })()}

        {/* Hour numbers in SPIRAL mode.
            12 clock positions, each stacked "PM / AM" -- so 6am sits DIRECTLY
            below 18h on the 3-o'clock side. The pairing is the whole point. */}
        {mode === "spiral" && Array.from({ length: 12 }, (_, h) => {
          const centre = -90 + h * 30;                        // 12,1,2..11 clock positions
          const [xPm, yPm] = polar(SPIRAL_OUTER + 14, centre); // outside outer ring
          const [xAm, yAm] = polar(SPIRAL_INNER - 12, centre); // inside inner ring
          const pm = (h + 12) % 24;
          const am = h;
          const anchor = h === 0 ? "12" : String(h);
          return (
            <g key={`spiral-h-${h}`}>
              <text x={xPm} y={yPm} textAnchor="middle" dominantBaseline="central" className="fill-muted" style={{ fontSize: 12, fontWeight: 700 }}>
                {pm === 0 ? "0" : pm}
              </text>
              <text x={xAm} y={yAm} textAnchor="middle" dominantBaseline="central" className="fill-faint" style={{ fontSize: 10, fontWeight: 600 }}>
                {am === 0 ? "12" : am}
              </text>
            </g>
          );
        })}

        {/* Outer ring numbers (PM), around the rim -- always visible. Rings mode only. */}
        {mode === "rings" && Array.from({ length: 12 }, (_, h) => {
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
        {/* Inner-ring numbers used to sit here (duplicated 1-12). They were
            redundant: the outer rim already labels the 12 clock positions,
            and the AM/PM chips added above disambiguate which half you are
            on. Keeping only one set of numbers reads far cleaner. */}

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
          // The "AM inside / PM outside" centre pair was redundant once the
          // AM/PM labels moved onto the rings themselves -- the picture
          // already says what half you're on. Leave the centre clean;
          // the drag hint is enough context for the paint case.
          onPaint ? (
            <text x={C} y={C} textAnchor="middle" dominantBaseline="central" className="fill-faint" style={{ fontSize: 11, fontWeight: 600 }}>
              drag to fill
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
