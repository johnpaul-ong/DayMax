"use client";

/**
 * The budget meter. One spend and it already says something.
 *
 * Money-pursuit charts fall apart on a new user: n = 1 gives a bar chart of a
 * single bar, a pie of one wedge, and a trend line of one dot — visually
 * empty, arithmetically valid. The meter is designed the other way round:
 *
 *   ONE entry:   fill %, a diagnosis line, a colour that means something
 *   FIVE:        pace vs the day of the month (are you on track?)
 *   TWENTY:      the arc fills day by day, plus the runway line
 *
 * The idea is stolen straight from the fitness dashboards you shared — a big
 * radial gauge above one huge number and one small label. It is the same
 * shape as a Move ring. Density comes later.
 */

import { useMemo } from "react";
import { GROUP_COLOR } from "@/lib/moneyColors";
import { money as fmtMoney } from "@/lib/money";

interface SpendPoint {
  date: string;      // "YYYY-MM-DD"
  amount: number;    // non-essential dollars for that day
}

interface Props {
  /** every non-essential spend in the current month. Empty is fine. */
  spend: SpendPoint[];
  /** monthly non-essential budget the person is aiming at. May be null. */
  budget: number | null;
  monthlyIncome?: number | null;
  currency?: string;
  today?: string;
}

const SIZE = 260;
const C = SIZE / 2;
const R = 106;
const STROKE = 22;
const TAU = Math.PI * 2;

/** describe an arc from -90deg (12 o'clock) sweeping clockwise by `frac` of a full turn. */
function arc(frac: number): string {
  const f = Math.max(0.0001, Math.min(1, frac));
  const start = -Math.PI / 2;
  const end = start + f * TAU;
  const large = f > 0.5 ? 1 : 0;
  const x0 = C + R * Math.cos(start);
  const y0 = C + R * Math.sin(start);
  const x1 = C + R * Math.cos(end);
  const y1 = C + R * Math.sin(end);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`;
}

/** ISO day-of-month, no timezone drama. */
function dom(iso: string): number {
  return Number(iso.slice(8, 10));
}
function monthLength(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export default function BudgetMeter({ spend, budget, monthlyIncome, currency, today }: Props) {
  const now = today ?? new Date().toISOString().slice(0, 10);
  const daysInMonth = monthLength(now);
  const dayNow = dom(now);
  const spent = useMemo(() => spend.reduce((s, p) => s + p.amount, 0), [spend]);

  // If no budget, fall back to 30% of stated income; if neither, we still have
  // something useful to say ("first spend of the month") — that's the point.
  const effective = budget ?? (monthlyIncome ? Math.round(monthlyIncome * 0.3) : null);

  // Where you SHOULD be by now, on a straight-line pace.
  const paceTarget = effective ? (effective * dayNow) / daysInMonth : null;
  const frac = effective && effective > 0 ? Math.min(1.6, spent / effective) : 0;
  const paceFrac = effective && effective > 0 ? paceTarget! / effective : 0;

  // Colour is the diagnosis, not just decoration.
  const status = statusFor(effective, spent, paceTarget);
  const stroke =
    status === "over" ? GROUP_COLOR.nonEssential : status === "ahead" ? "var(--warn)" : GROUP_COLOR.essential;

  // Runway: how many more days at this pace will burn the budget?
  const perDay = dayNow > 0 ? spent / dayNow : 0;
  const runway = effective && perDay > 0 ? Math.floor((effective - spent) / perDay) : null;

  const primary = fmtMoney(spent, currency);
  const of = effective != null ? ` of ${fmtMoney(effective, currency)}` : "";
  const line = headline({ spent, effective, dayNow, daysInMonth, paceTarget, runway, status, currency });

  return (
    <div className="card p-5">
      <div className="flex flex-col items-center">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[280px]">
          {/* track */}
          <path d={arc(0.999)} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} strokeLinecap="round" />
          {/* pace tick — where you should be, so "am I on track" is one glance */}
          {effective && paceFrac > 0 && paceFrac < 1 && (
            <line
              x1={C + (R - STROKE / 2 - 2) * Math.cos(-Math.PI / 2 + paceFrac * TAU)}
              y1={C + (R - STROKE / 2 - 2) * Math.sin(-Math.PI / 2 + paceFrac * TAU)}
              x2={C + (R + STROKE / 2 + 2) * Math.cos(-Math.PI / 2 + paceFrac * TAU)}
              y2={C + (R + STROKE / 2 + 2) * Math.sin(-Math.PI / 2 + paceFrac * TAU)}
              stroke="var(--muted)"
              strokeWidth={2}
            />
          )}
          {/* fill — capped at 100% visually. Over-budget wraps a second, thinner arc. */}
          <path d={arc(Math.min(1, frac))} fill="none" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
          {frac > 1 && (
            <path d={arc(Math.min(0.999, frac - 1))} fill="none" stroke={stroke} strokeWidth={6} strokeLinecap="round" opacity={0.6} />
          )}
          {/* the giant number, iOS-style */}
          <text x={C} y={C - 6} textAnchor="middle" dominantBaseline="central" className="fill-ink" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {primary}
          </text>
          <text x={C} y={C + 22} textAnchor="middle" dominantBaseline="central" className="fill-muted" style={{ fontSize: 11, fontWeight: 500 }}>
            {of ? `non-essential${of}` : "non-essential this month"}
          </text>
        </svg>
        <p className="mt-2 text-center text-sm text-muted">{line}</p>
        {effective && (
          <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-faint">
            <span>day {dayNow} of {daysInMonth}</span>
            {perDay > 0 && <span>{fmtMoney(Math.round(perDay), currency)} / day at this pace</span>}
            {runway != null && runway >= 0 && <span>budget lasts {runway} more day{runway === 1 ? "" : "s"}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Diagnose the state ONCE, in one place, so colour, headline and later
 * changes all agree. Untested plain arithmetic — verify by walking cases:
 *   no data           -> "start"
 *   under pace        -> "on-track"
 *   ahead of pace     -> "ahead" (over-spending, not "on the way to winning")
 *   over budget       -> "over"
 */
type Status = "start" | "on-track" | "ahead" | "over";
function statusFor(effective: number | null, spent: number, pace: number | null): Status {
  if (!effective) return "start";
  if (spent > effective) return "over";
  if (pace != null && spent > pace * 1.1) return "ahead";
  return "on-track";
}

function headline({
  spent,
  effective,
  dayNow,
  daysInMonth,
  paceTarget,
  runway,
  status,
  currency,
}: {
  spent: number;
  effective: number | null;
  dayNow: number;
  daysInMonth: number;
  paceTarget: number | null;
  runway: number | null;
  status: Status;
  currency: string | undefined;
}): string {
  if (!effective) {
    if (spent === 0) return "Set a monthly non-essential budget below and this meter comes alive.";
    return `${fmtMoney(spent, currency)} non-essential this month. Add a budget below and this becomes a pace-tracker.`;
  }
  if (spent === 0) return "Nothing non-essential yet this month. The meter fills as you log.";
  const daysLeft = daysInMonth - dayNow;
  if (status === "over") {
    const over = spent - effective;
    return `Over budget by ${fmtMoney(over, currency)} with ${daysLeft} day${daysLeft === 1 ? "" : "s"} still to go.`;
  }
  if (status === "ahead" && paceTarget != null) {
    const ahead = spent - paceTarget;
    return `Spending ${fmtMoney(Math.round(ahead), currency)} ahead of pace. At this rate the ${fmtMoney(effective, currency)} budget runs out on day ${Math.min(daysInMonth, dayNow + (runway ?? 0))}.`;
  }
  const left = effective - spent;
  return `${fmtMoney(left, currency)} left for the last ${daysLeft} day${daysLeft === 1 ? "" : "s"} — you can spend ${fmtMoney(Math.round(left / Math.max(1, daysLeft)), currency)} a day and stay on target.`;
}
