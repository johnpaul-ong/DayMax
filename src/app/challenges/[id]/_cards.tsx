"use client";

/**
 * Rendering pieces extracted from challenges/[id]/page.tsx.
 *
 *   Guarded         a chart-or-explain wrapper: draws the chart, or
 *                   swaps in a ChartEmpty with the reason.
 *   BoardDiagnosis  the single "why the board is thin" banner, chosen
 *                   between four possible causes (not started / nothing
 *                   logged / no scores / only member).
 *   YouScore        the non-money You card (one number in its unit).
 *   YouCard         the money You card (You + Average rows + income
 *                   editor + share-amounts toggle).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartEmpty, BoardNotice, type EmptyCause } from "../../empty-chart";
import {
  currencySymbol,
  formatScore,
  money,
  setIncomeOverride,
  setShareAmounts,
  type Standing,
} from "@/lib/money";

export function Guarded({
  title,
  sub,
  cause,
  noun,
  loggedLabel,
  startsOn,
  days,
  action,
  small,
  children,
}: {
  title: string;
  sub?: string;
  cause: EmptyCause | null;
  noun: string;
  loggedLabel?: string;
  startsOn?: string;
  days?: number;
  action?: { href: string; label: string };
  small?: boolean;
  children: React.ReactNode;
}) {
  const Heading = small ? "h3" : "h2";
  return (
    <section>
      <Heading className={small ? "mb-1 text-sm font-semibold" : "mb-1 font-semibold"}>{title}</Heading>
      {sub && !cause && <p className="mb-2 text-sm text-muted">{sub}</p>}
      {cause ? (
        <ChartEmpty cause={cause} noun={noun} loggedLabel={loggedLabel} startsOn={startsOn} days={days} action={action} />
      ) : (
        children
      )}
    </section>
  );
}

export function BoardDiagnosis({
  started,
  entries,
  allEssential,
  members,
  scored,
  startsOn,
  noun,
  logHref,
}: {
  started: boolean;
  entries: number;
  allEssential: boolean;
  loggedLabel?: string;
  members: number;
  scored: number;
  startsOn: string;
  noun: string;
  logHref: string;
}) {
  if (!started)
    return (
      <BoardNotice tone="quiet">
        This challenge starts on <b>{startsOn}</b>. Nothing counts until then, so the board stays empty — anything you
        log before it opens is your own business.
      </BoardNotice>
    );

  if (entries === 0)
    return (
      <BoardNotice
        tone="quiet"
        action={{ href: logHref, label: "Start logging →" }}
        title="Nothing logged yet"
      >
        No one in this challenge has logged anything inside the window, so there is nothing to rank and nothing to
        chart.
      </BoardNotice>
    );

  // Everything essential = duplicative of empty charts + YouCard.
  if (allEssential) return null;

  if (scored === 0)
    return (
      <BoardNotice tone="quiet" action={{ href: logHref, label: "Log something →" }}>
        Nobody has a score yet — {noun} needs something logged inside the window before anyone can be ranked.
      </BoardNotice>
    );

  if (members <= 1)
    return (
      <BoardNotice tone="quiet">
        You&apos;re the only member, so every comparison on this board is you against yourself. Your own trend still
        works; the head-to-head charts need a second person.
      </BoardNotice>
    );

  return null;
}

/** The non-money version of the You card: one number, in its own unit. */
export function YouScore({
  me,
  rank,
  metricLabel,
  fmt,
  unit,
  logHref,
}: {
  me: Standing;
  rank: number;
  metricLabel: string;
  fmt: (v: number | null | undefined) => string;
  unit: string;
  logHref: string;
}) {
  return (
    <div className="card p-4">
      <h2 className="mb-2 font-semibold">You</h2>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-3xl font-bold tabular-nums">{fmt(me.score)}</p>
          <p className="text-xs text-muted">{metricLabel.toLowerCase()}</p>
        </div>
        {me.perDay > 0 && (
          <div>
            <p className="text-3xl font-bold tabular-nums">{formatScore(me.perDay, unit)}</p>
            <p className="text-xs text-muted">a day</p>
          </div>
        )}
        <div>
          <p className="text-3xl font-bold tabular-nums">{me.entries}</p>
          <p className="text-xs text-muted">days logged</p>
        </div>
        {me.score != null && rank > 0 && (
          <div>
            <p className="text-3xl font-bold tabular-nums">#{rank}</p>
            <p className="text-xs text-muted">right now</p>
          </div>
        )}
      </div>
      {me.score == null && (
        <p className="mt-3 text-sm text-muted">
          You have nothing logged inside the window, so you are unranked rather than last.{" "}
          <Link href={logHref} className="font-medium text-accent hover:underline">Log a day →</Link>
        </p>
      )}
      {/* The old "this challenge doesn't read your spending" footer was
          killed on feedback -- a money reassurance on a non-money card
          answers a question nobody was asking. */}
    </div>
  );
}

/** Your own numbers, and the income baseline you can nudge. Money only. */
export function YouCard({
  challengeId,
  me,
  rows,
  currency,
  metricLabel,
  unit,
  onChanged,
}: {
  challengeId: string;
  me: Standing;
  rows: Standing[];
  currency?: string;
  metricLabel: string;
  unit: string;
  onChanged: () => void;
}) {
  const [income, setIncome] = useState(me.income != null ? String(me.income) : "");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setIncome(me.income != null ? String(me.income) : "");
  }, [me.income]);

  const m = (v: number | null | undefined) => money(v, currency);
  const pctOf = (v: number | null, base: number | null) =>
    base != null && base > 0 && v != null ? Math.round((v / base) * 1000) / 10 : null;

  const avg = (pick: (r: Standing) => number | null): number | null => {
    const xs = rows.map(pick).filter((v): v is number => v != null);
    if (xs.length === 0) return null;
    return xs.reduce((s, v) => s + v, 0) / xs.length;
  };
  const avgNon = avg((r) => r.nonEssential);
  const avgEss = avg((r) => r.essential);
  const avgTot = avg((r) => r.total);
  const avgPerDay = avg((r) => r.perDay);

  const left = me.income != null && me.total != null ? me.income - me.total : null;

  const Row = ({
    label,
    tone,
    ne, es, tot, perDay, income,
  }: {
    label: string;
    tone: "you" | "avg";
    ne: number | null;
    es: number | null;
    tot: number | null;
    perDay: number | null;
    income: number | null;
  }) => (
    <div className={`rounded-lg ${tone === "you" ? "bg-accent-soft/30" : "bg-surface-2"} p-3`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        <div>
          <p className="text-xl font-bold tabular-nums">{m(ne)}</p>
          <p className="text-[10px] text-muted">non-essential{income != null && income > 0 && ne != null && <> · {pctOf(ne, income)}%</>}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{m(es)}</p>
          <p className="text-[10px] text-muted">essential{income != null && income > 0 && es != null && <> · {pctOf(es, income)}%</>}</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{m(tot)}</p>
          <p className="text-[10px] text-muted">all spending</p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{m(perDay)}</p>
          <p className="text-[10px] text-muted">a day</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="card p-4">
      <div className="space-y-2">
        <Row label="You" tone="you" ne={me.nonEssential} es={me.essential} tot={me.total} perDay={me.perDay} income={me.income} />
        {rows.length > 1 && (
          <Row label={`Average of ${rows.length}`} tone="avg" ne={avgNon} es={avgEss} tot={avgTot} perDay={avgPerDay} income={null} />
        )}
      </div>

      {me.income != null && me.income > 0 && (
        <div className="mt-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
            <div style={{ width: `${Math.min(100, ((me.essential ?? 0) / me.income) * 100)}%`, background: "#16a34a" }} title={`essential ${m(me.essential)}`} />
            <div style={{ width: `${Math.min(100, ((me.nonEssential ?? 0) / me.income) * 100)}%`, background: "#dc2626" }} title={`non-essential ${m(me.nonEssential)}`} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {m(me.income)} income · {m(me.total)} spent · <b>{m(left)}</b> left
          </p>
        </div>
      )}

      {me.topCategory && (
        <p className="mt-2 text-sm text-muted">
          Your biggest non-essential is <b>{me.topCategory}</b>
          {me.topCategoryAmount != null && <> at {m(me.topCategoryAmount)}</>}.
        </p>
      )}

      <div className="mt-3 border-t pt-3">
        <label className="text-xs font-medium uppercase tracking-wider text-faint">Income for this challenge</label>
        <p className="mb-2 text-xs text-muted">
          Defaults to your last income entry before the challenge started — most people are paid monthly, so what
          landed during these 30 days is usually the wrong number. Change it to whatever you&apos;re actually living on.
          <br />
          {unit === "%" ? (
            <>
              <b>This challenge ranks on a percentage of income</b>, so changing this number moves the standings
              directly — it is the denominator.
            </>
          ) : (
            <>
              <b>This only moves the percentages.</b> {metricLabel} decides the standings, so the leaderboard, the
              race chart and the daily chart stay exactly where they were — income changes &ldquo;% of income&rdquo;
              and the percentage view of the board, nothing else.
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-surface px-2">
            <span className="text-muted">{currencySymbol(currency)}</span>
            <input
              value={income}
              onChange={(e) => setIncome(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-28 bg-transparent py-2 text-sm tabular-nums outline-none"
            />
          </div>
          <button
            onClick={() => {
              const n = income.trim() === "" ? null : Number(income);
              const v = n != null && Number.isFinite(n) ? n : null;
              setErr(null);
              setIncomeOverride(challengeId, v)
                .then(() => {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1800);
                  onChanged();
                })
                .catch((e) => setErr(String(e.message ?? e)));
            }}
            className="btn-ghost py-2"
          >
            {saved ? "Saved ✓" : "Set"}
          </button>
          <button
            onClick={() => {
              setIncome("");
              setIncomeOverride(challengeId, null).then(onChanged).catch((e) => setErr(String(e.message ?? e)));
            }}
            className="text-xs text-muted hover:text-accent"
          >
            reset to automatic
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      </div>

      <label className="mt-3 flex items-start gap-2 border-t pt-3 text-sm">
        <input
          type="checkbox"
          checked={me.sharesAmounts}
          onChange={(e) => void setShareAmounts(challengeId, e.target.checked).then(onChanged)}
          className="mt-0.5"
        />
        <span>
          <b>Show my dollar breakdown</b> to other members. Your ranking total is shared either way — this is about
          the detail behind it.
        </span>
      </label>
    </div>
  );
}
