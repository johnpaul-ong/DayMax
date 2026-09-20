"use client";

/**
 * What to draw when there is nothing to draw.
 *
 * An empty recharts container is not an empty state: it renders a full axis
 * grid with plausible tick labels and no marks, which reads as "broken" rather
 * than "you haven't given me anything yet". The Budget Baddies board showed six
 * of them at once — all arithmetically correct, all $0, all useless.
 *
 * So: a chart with nothing in it does not render. It renders a sentence
 * instead, and the sentence has to say WHY, because the fixes are different.
 * `EmptyCause` is that taxonomy — one member is not the same problem as one
 * day, and neither is the same as "you logged $600 and called all of it
 * essential, so the number we rank is zero".
 *
 * Callers decide the cause with `emptyCause()` and render `<ChartEmpty>` in
 * place of the chart. The same two pieces cover the money pages and the
 * challenge board, so the treatment is one thing to change, not eight.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export type EmptyCause =
  /** Nobody has logged anything in this window. */
  | "no-data"
  /** You are the only member, so there is nothing to compare against. */
  | "solo"
  /** There IS spending, but all of it is essential, so the ranked number is 0. */
  | "all-essential"
  /** Everything logged scores zero — the non-money version of all-essential. */
  | "all-zero"
  /** The window hasn't begun. */
  | "not-started"
  /** Too few days for a line to mean anything. */
  | "too-short"
  /** A percentage-of-income chart with no income on record. */
  | "no-income";

export interface EmptyContext {
  /** False when the window has not started yet. Omit if it always has. */
  started?: boolean;
  /** How many people this chart compares. */
  members?: number;
  /** Set on charts that only make sense with two or more people. */
  comparesPeople?: boolean;
  /** Raw records in the window — entries logged, of any kind. */
  entries?: number;
  /** The total of the thing this chart actually plots. */
  plotted?: number;
  /** Total of everything logged, when `plotted` is a subset of it. */
  logged?: number;
  /** Distinct days of data available. */
  days?: number;
  /** How many days this chart needs before it says anything. Default 2. */
  minDays?: number;
  /** Income on record, for charts that divide by it. */
  income?: number;
  /** Set when `plotted`'s subset is "non-essential" specifically. */
  moneySubset?: boolean;
}

/**
 * The single reason this chart has nothing to say, or null when it should
 * render. Order matters: the earliest check is the one the user must fix
 * first. There is no point telling someone their trend is too short when the
 * challenge has not started.
 */
export function emptyCause(ctx: EmptyContext): EmptyCause | null {
  const {
    started = true,
    members = 2,
    comparesPeople = false,
    entries,
    plotted,
    logged,
    days,
    minDays = 2,
    income,
    moneySubset = false,
  } = ctx;

  if (!started) return "not-started";
  if (entries != null && entries === 0) return "no-data";
  if (comparesPeople && members <= 1) return "solo";
  if (income != null && income <= 0) return "no-income";
  if (plotted != null && plotted === 0) {
    if (logged != null && logged > 0) return moneySubset ? "all-essential" : "all-zero";
    if (entries == null) return "no-data";
    return moneySubset ? "all-essential" : "all-zero";
  }
  if (days != null && days < minDays) return "too-short";
  return null;
}

export interface ChartEmptyProps {
  cause: EmptyCause;
  /** What the chart would have plotted: "non-essential spend", "sleep hours". */
  noun?: string;
  /** Formatted total of everything logged — for the all-essential sentence. */
  loggedLabel?: string;
  /** When the window opens, for "not-started". */
  startsOn?: string;
  days?: number;
  minDays?: number;
  /** Where to go and do something about it. */
  action?: { href: string; label: string };
  /** Override the generated sentence entirely when the chart needs a specific one. */
  children?: ReactNode;
  className?: string;
}

/**
 * The replacement for a chart. Deliberately not chart-shaped and not
 * chart-height: a 256px dashed box is still a hole in the page. It's a line of
 * text in a quiet card, and it takes the room it needs.
 */
export function ChartEmpty({
  cause,
  noun = "this",
  loggedLabel,
  startsOn,
  days,
  minDays = 2,
  action,
  children,
  className = "",
}: ChartEmptyProps) {
  return (
    <div className={`card border-dashed p-4 text-sm text-muted ${className}`}>
      {children ?? defaultSentence(cause, { noun, loggedLabel, startsOn, days, minDays })}
      {action && (
        <>
          {" "}
          <Link href={action.href} className="font-medium text-accent hover:underline">
            {action.label}
          </Link>
        </>
      )}
    </div>
  );
}

function defaultSentence(
  cause: EmptyCause,
  { noun, loggedLabel, startsOn, days, minDays }: {
    noun: string;
    loggedLabel?: string;
    startsOn?: string;
    days?: number;
    minDays: number;
  }
): ReactNode {
  switch (cause) {
    case "not-started":
      return <>Nothing to chart yet — this starts {startsOn ? `on ${startsOn}` : "later"}.</>;
    case "no-data":
      return <>Nothing logged in this window, so there is no {noun} to chart.</>;
    case "solo":
      return <>You are the only person here, so there is nothing to compare {noun} against.</>;
    case "all-essential":
      return (
        <>
          {loggedLabel ? <>Every {loggedLabel} logged here is marked <b>essential</b></> : <>Everything logged here is marked <b>essential</b></>}
          , so {noun} is zero and this chart would be a flat line on nothing.
        </>
      );
    case "all-zero":
      return <>Every {noun} figure in this window is zero, so there is nothing to plot.</>;
    case "too-short":
      return (
        <>
          {days ?? 0} day{days === 1 ? "" : "s"} of data so far — a trend needs at least {minDays}.
        </>
      );
    case "no-income":
      return <>No income on record for this window, so {noun} can&apos;t be worked out.</>;
  }
}

/**
 * One banner at the top of a board, for the diagnosis that explains most of
 * the empty space below it. Six identical "it's all essential" notes is six
 * times worse than one.
 */
export function BoardNotice({
  tone = "warn",
  title,
  children,
  action,
}: {
  tone?: "warn" | "quiet";
  title?: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  const skin = tone === "warn" ? "bg-warn-soft text-warn" : "card text-muted";
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ${skin}`}>
      {title && <p className="font-semibold">{title}</p>}
      <p className={title ? "mt-0.5" : ""}>
        {children}
        {action && (
          <>
            {" "}
            <Link href={action.href} className="font-medium underline">
              {action.label}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
