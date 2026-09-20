"use client";

/**
 * The challenge metric vocabulary. Mirrors challenge_metric_*() in
 * migration 0038 -- the SQL is the authority (it computes and ranks),
 * but the picker needs the same list, and the client needs to format
 * a score it did not compute.
 *
 * Extracted from money.ts. money.ts re-exports these names for
 * backwards compatibility.
 */

import { money } from "./currency";

/**
 * A challenge is one sentence: over THIS WINDOW, rank members by THIS NUMBER,
 * where MORE or LESS wins. The three parts are independent —
 *
 *   metric     what number to compute
 *   direction  which end of it wins ('more' | 'less')
 *   statId     which pursuit stat, when metric is 'pursuit_stat'
 *
 * `lower_nonessential` and `lower_nonessential_pct` are the two original
 * spellings from migration 0035, which baked the direction into the name.
 * They still exist on live rows (Budget Baddies is one) and still rank
 * identically; `canonicalMetric()` folds them onto their new names, exactly
 * as `challenge_metric()` does in SQL. Never write them on a new challenge.
 */
export type ChallengeMetric =
  | "lower_nonessential"
  | "lower_nonessential_pct"
  | "money_nonessential"
  | "money_nonessential_pct"
  | "money_total"
  | "life_productive_hours"
  | "life_workmax"
  | "life_focus"
  | "life_brainrot_hours"
  | "life_sleep_hours"
  | "life_streak"
  | "pursuit_stat";

export type ChallengeDirection = "more" | "less";
export type MetricFamily = "money" | "life" | "stat";

export const MONEY_PURSUIT_ID = "33333333-3333-4333-8333-333333333305";
export const LIFE_PURSUIT_ID = "33333333-3333-4333-8333-333333333301";

export interface MetricOption {
  metric: ChallengeMetric;
  family: MetricFamily;
  /** The noun, without a "most"/"least" on the front. */
  noun: string;
  /** One line explaining where the number comes from. */
  hint: string;
  direction: ChallengeDirection;
  unit: string;
  group: string;
}

/**
 * Everything the UI may offer, in picker order. Legacy spellings are NOT here:
 * they are readable, not writable. Every entry has a matching branch in
 * challenge_standings() — if the server cannot rank it, it does not appear.
 */
export const CHALLENGE_METRICS: MetricOption[] = [
  {
    metric: "money_nonessential",
    family: "money",
    noun: "non-essential spending",
    hint: "What you spent on things you didn't need. Essentials — rent, groceries, bills, transport — don't count.",
    direction: "less",
    unit: "currency",
    group: "Money",
  },
  {
    metric: "money_nonessential_pct",
    family: "money",
    noun: "non-essential spending, as a share of income",
    hint: "The same number over your own income, so a student and a surgeon compete fairly.",
    direction: "less",
    unit: "%",
    group: "Money",
  },
  {
    metric: "money_total",
    family: "money",
    noun: "total spending",
    hint: "Everything logged, essential or not.",
    direction: "less",
    unit: "currency",
    group: "Money",
  },
  {
    metric: "life_productive_hours",
    family: "life",
    noun: "productive hours",
    hint: "Hours in your productive categories on the day grid. Default: Work and Sports.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_workmax",
    family: "life",
    noun: "WorkMax",
    hint: "Productive hours weighted by how clean they were — 79 productive hours next to 20 of brainrot scores 62.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_focus",
    family: "life",
    noun: "focus score",
    hint: "Productive as a share of productive + brainrot, 0 to 100. Ignores volume entirely.",
    direction: "more",
    unit: "pts",
    group: "Life",
  },
  {
    metric: "life_brainrot_hours",
    family: "life",
    noun: "brainrot hours",
    hint: "Hours in your brainrot categories. Default: Other and Leisure.",
    direction: "less",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_sleep_hours",
    family: "life",
    noun: "sleep",
    hint: "Hours logged as Sleep on the day grid.",
    direction: "more",
    unit: "h",
    group: "Life",
  },
  {
    metric: "life_streak",
    family: "life",
    noun: "logging streak",
    hint: "The longest run of consecutive days with anything logged. A consistency contest, not a performance one.",
    direction: "more",
    unit: "days",
    group: "Life",
  },
  {
    metric: "pursuit_stat",
    family: "stat",
    noun: "a pursuit stat",
    hint: "Any stat from a pursuit you're in — pages read, kilometres run, cigarettes not smoked.",
    direction: "more",
    unit: "",
    group: "Pursuits",
  },
];

/** Legacy spellings fold onto their new names. Same mapping as SQL. */
export function canonicalMetric(m: ChallengeMetric | string): ChallengeMetric {
  if (m === "lower_nonessential") return "money_nonessential";
  if (m === "lower_nonessential_pct") return "money_nonessential_pct";
  return (m as ChallengeMetric) ?? "money_nonessential";
}

export function metricOption(m: ChallengeMetric | string): MetricOption | undefined {
  const canon = canonicalMetric(m);
  return CHALLENGE_METRICS.find((o) => o.metric === canon);
}

export function metricFamily(m: ChallengeMetric | string): MetricFamily {
  return metricOption(m)?.family ?? "life";
}

export function defaultDirection(m: ChallengeMetric | string, statDirection?: ChallengeDirection | null): ChallengeDirection {
  if (canonicalMetric(m) === "pursuit_stat") return statDirection ?? "more";
  return metricOption(m)?.direction ?? "more";
}

export function metricUnit(m: ChallengeMetric | string, statUnit?: string | null): string {
  if (canonicalMetric(m) === "pursuit_stat") return (statUnit ?? "").trim();
  return metricOption(m)?.unit ?? "";
}

/** "Most productive hours". Matches challenge_metric_label() in SQL. */
export function metricLabel(
  m: ChallengeMetric | string,
  direction: ChallengeDirection,
  statName?: string | null
): string {
  const canon = canonicalMetric(m);
  if (canon === "life_streak") return direction === "less" ? "Shortest logging streak" : "Longest logging streak";
  const noun = canon === "pursuit_stat" ? (statName?.trim() || "a pursuit stat") : metricOption(canon)?.noun ?? "the score";
  return `${direction === "less" ? "Least" : "Most"} ${noun}`;
}

/** Which pursuit a challenge on this metric hangs off, so members can log. */
export function pursuitForMetric(m: ChallengeMetric | string): string | null {
  const fam = metricFamily(m);
  if (fam === "money") return MONEY_PURSUIT_ID;
  if (fam === "life") return LIFE_PURSUIT_ID;
  return null; // a stat challenge points at the stat's own pursuit
}

/**
 * Render a score in its own unit. 'currency' is the sentinel the server sends
 * for money metrics — the symbol is the viewer's, not a hardcoded dollar.
 */
export function formatScore(value: number | null | undefined, unit: string, currency?: string): string {
  if (value == null) return "—";
  if (unit === "currency") return money(value, currency);
  const n = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (unit === "%") return `${n}%`;
  if (unit === "") return n;
  return `${n} ${unit}`;
}
