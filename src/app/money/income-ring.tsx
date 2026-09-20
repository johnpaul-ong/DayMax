"use client";

/**
 * The income ring. Every person, one shared vocabulary.
 *
 * A month's income is a full circle. It splits three ways:
 *
 *   essential      — cool green family; each category a darker/lighter shade
 *   non-essential  — warm red family; each category a shade
 *   unspent        — the rest, neutral grey
 *
 * That's it. Every person in a challenge gets one of these; sit them side by
 * side and comparison is instant — same denominator, same colour vocabulary,
 * same shape.
 *
 * If income is missing the ring falls back to "known spending is the whole",
 * with an unlabelled sentence saying so.
 */

import { useMemo } from "react";
import { categorySwatch, GROUP_COLOR } from "@/lib/moneyColors";
import { money as fmtMoney } from "@/lib/money";

export interface RingSlice {
  categoryId: string | null;
  name: string;
  essential: boolean;
  amount: number;
}

interface Props {
  slices: RingSlice[];
  income: number | null;
  currency?: string;
  size?: number;
  /** For the panel comparison view — small caption above the ring */
  name?: string;
  /** subtitle under the name, e.g. "you" or "leader" */
  subtitle?: string;
  compact?: boolean;
}

const DEFAULT_SIZE = 260;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** SVG arc for the outer + inner curve of an annulus wedge. */
function annulusPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

export default function IncomeRing({ slices, income, currency, size = DEFAULT_SIZE, name, subtitle, compact }: Props) {
  const c = size / 2;
  const stroke = compact ? 14 : 22;
  const r1 = c - stroke - 4;
  const r0 = r1 - stroke;

  const { arcs, essTotal, nonTotal, unspent, denom, hasIncome } = useMemo(() => {
    const ess = slices.filter((s) => s.essential && s.amount > 0).sort((a, b) => b.amount - a.amount);
    const non = slices.filter((s) => !s.essential && s.amount > 0).sort((a, b) => b.amount - a.amount);
    const essTotal = ess.reduce((s, r) => s + r.amount, 0);
    const nonTotal = non.reduce((s, r) => s + r.amount, 0);
    const spent = essTotal + nonTotal;
    const hasIncome = income != null && income > 0;
    // If no income, the ring shows spending only. This is the honest thing to
    // do — a ring reading 100% "unspent" against £0 of income is a lie.
    const denom = hasIncome ? Math.max(income!, spent) : Math.max(spent, 1);
    const unspent = Math.max(0, denom - spent);

    // Walk the circle clockwise: essential slices first (green family),
    // then non-essential (red family), then unspent grey at the end. Each
    // category gets a shade FROM its family via categorySwatch.
    const out: Array<{ id: string; a0: number; a1: number; color: string; label: string; amount: number; group: "ess" | "non" | "un" }> = [];
    let cursor = 0;
    ess.forEach((s, i) => {
      const span = (s.amount / denom) * 360;
      out.push({
        id: `e-${s.categoryId ?? s.name}`,
        a0: cursor,
        a1: cursor + span,
        color: categorySwatch(true, i),
        label: s.name,
        amount: s.amount,
        group: "ess",
      });
      cursor += span;
    });
    non.forEach((s, i) => {
      const span = (s.amount / denom) * 360;
      out.push({
        id: `n-${s.categoryId ?? s.name}`,
        a0: cursor,
        a1: cursor + span,
        color: categorySwatch(false, i),
        label: s.name,
        amount: s.amount,
        group: "non",
      });
      cursor += span;
    });
    if (unspent > 0.005) {
      const span = (unspent / denom) * 360;
      out.push({
        id: "unspent",
        a0: cursor,
        a1: cursor + span,
        color: "var(--surface-2)",
        label: hasIncome ? "unspent" : "no income logged",
        amount: unspent,
        group: "un",
      });
    }
    return { arcs: out, essTotal, nonTotal, unspent, denom, hasIncome };
  }, [slices, income]);

  const anyData = arcs.length > 0 && (essTotal > 0 || nonTotal > 0);

  return (
    <div className="flex flex-col items-center">
      {name && (
        <div className="mb-1 text-center">
          <p className="text-sm font-semibold">{name}</p>
          {subtitle && <p className="text-[10px] uppercase tracking-wider text-faint">{subtitle}</p>}
        </div>
      )}
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="block">
        {/* base track so an empty ring still reads as a ring */}
        <circle cx={c} cy={c} r={(r0 + r1) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={r1 - r0} opacity={anyData ? 0.35 : 1} />
        {arcs.map((a) => (
          <path key={a.id} d={annulusPath(c, c, r0, r1, a.a0, Math.min(a.a1, a.a0 + 359.9))} fill={a.color}>
            <title>{`${a.label} · ${fmtMoney(a.amount, currency)}`}</title>
          </path>
        ))}

        {/* centre readout — spent / income */}
        <text x={c} y={c - (compact ? 4 : 8)} textAnchor="middle" dominantBaseline="central" className="fill-ink stat-num" style={{ fontSize: compact ? 22 : 34 }}>
          {fmtMoney(essTotal + nonTotal, currency)}
        </text>
        <text x={c} y={c + (compact ? 12 : 22)} textAnchor="middle" dominantBaseline="central" className="fill-muted" style={{ fontSize: compact ? 9 : 11 }}>
          {hasIncome ? `of ${fmtMoney(denom, currency)} income` : "spent · no income set"}
        </text>
      </svg>

      {!compact && (
        <div className="mt-3 grid w-full max-w-[320px] grid-cols-3 gap-2 text-center text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-faint">Essential</p>
            <p className="tabular-nums" style={{ color: GROUP_COLOR.essential }}>{fmtMoney(essTotal, currency)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-faint">Non-essential</p>
            <p className="tabular-nums" style={{ color: GROUP_COLOR.nonEssential }}>{fmtMoney(nonTotal, currency)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-faint">Unspent</p>
            <p className="tabular-nums text-muted">{hasIncome ? fmtMoney(unspent, currency) : "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A row of small rings, one per person, so a challenge board reads at a
 * glance without a table: same denominator, same colour vocabulary, same
 * shape. The person with the smallest slice of red is winning.
 */
export function IncomeRingPanel({
  rows,
  currency,
}: {
  rows: Array<{ id: string; name: string; subtitle?: string; slices: RingSlice[]; income: number | null }>;
  currency?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card p-4">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Everyone in this challenge</p>
        <p className="text-sm text-muted">
          Same denominator (each person&apos;s own income), same colour language. The bigger the red slice, the worse the month.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <IncomeRing key={r.id} name={r.name} subtitle={r.subtitle} slices={r.slices} income={r.income} currency={currency} size={200} compact />
        ))}
      </div>
    </div>
  );
}
