"use client";

/**
 * A challenge board that's worth opening twice a day.
 *
 * Ranked on whatever number the challenge is actually about — least
 * non-essential spend, most sleep, longest streak, a pursuit's own stat — with
 * the supporting views alongside. Rank on the number they care about; inform
 * with the rest.
 *
 * Two things this page used to get wrong:
 *
 *  1. It assumed money. Every score went through money(), every sentence said
 *     "non-essential spending", so a 31-hour WorkMax lead rendered as "$31.00".
 *     Nothing here formats a number itself any more: the unit, the label and
 *     the ranking direction all come off the row the server sent
 *     (Standing.scoreUnit / .scoreLabel / .rankLess, Challenge.metricLabel /
 *     .direction), via formatScore().
 *
 *  2. It drew charts with nothing in them. Six empty axis grids is what you
 *     got as a solo member whose spending was all essential — correct, and
 *     useless. Every chart is now guarded by emptyCause(), and the one
 *     diagnosis that explains all of them is stated once at the top instead of
 *     six times down the page.
 *
 * Privacy shape: joining shares your position. Dollar amounts are opt-in and
 * off by default, so the table shows "private" rather than a number for anyone
 * who hasn't switched them on. They still rank. On a non-money challenge the
 * spend tables are never read at all, so the money sections hide themselves
 * rather than render empty.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { localToday } from "@/lib/dates";
import {
  canonicalMetric,
  currencySymbol,
  fetchChallengeCategories,
  fetchChallengeDaily,
  fetchChallenges,
  fetchCurrency,
  fetchInvitableFriends,
  fetchStandings,
  formatScore,
  inviteFriend,
  joinChallenge,
  leaveChallenge,
  metricFamily,
  money,
  type Challenge,
  type ChallengeCategory,
  type ChallengeDay,
  type InvitableFriend,
  type Standing,
} from "@/lib/money";
import { teamMeta } from "@/lib/teams";
import { TeamDot } from "../../team-name";
import { ChartEmpty, emptyCause } from "../../empty-chart";
import ChallengeFeed from "./feed";
import { BoardDiagnosis, Guarded, YouCard, YouScore } from "./_cards";
import { AverageDayClock, MembersDayColumns, MembersHoursBars } from "./_life-views";

const SERIES = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tick = (d: string) => (typeof d === "string" ? d.slice(5) : d);

/** "Least non-essential spending" -> "non-essential spending". */
function nounOf(label: string | null | undefined): string {
  const l = (label ?? "").trim();
  const m = l.match(/^(?:Most|Least|Longest|Shortest)\s+(.+)$/);
  if (m) return m[1];
  return l ? l.charAt(0).toLowerCase() + l.slice(1) : "the score";
}

function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * "Grindset Goblins" -> "Goblins". "Budget Baddies" -> "Baddies".
 * "Deep Work Demons" -> "Demons". Anything without a plural-looking
 * last word falls back to "Members".
 *
 * Runs on the challenge name so tribes stay self-branded without a
 * schema change. Deliberately loose: any capitalised word ending in
 * -s / -es / -ies is treated as a plural noun.
 */
function rosterNoun(challengeName: string): string {
  const last = challengeName.trim().split(/\s+/).pop() ?? "";
  if (/^[A-Z][a-z]+(s|es|ies)$/.test(last)) return last;
  return "Members";
}

/**
 * Plain-English "how this challenge is scored" block. Shows the
 * formula the SECURITY DEFINER challenge_standings function uses,
 * so the ranked column isn't a mystery. Rendered under the header
 * description on every challenge page (asked by the user for
 * Grindset Goblins; harmless everywhere).
 */
function MetricRules({
  metric,
  rankLess,
}: {
  metric: string;
  rankLess: boolean;
}) {
  const [open, setOpen] = useState(false);
  const short = (() => {
    switch (metric) {
      case "life_workmax":
        return "Depth × hours: (productive ÷ (productive + brainrot)) × productive hours.";
      case "life_focus":
        return "Focus %: productive ÷ (productive + brainrot) × 100.";
      case "life_productive_hours":
        return "Productive hours logged (Work + Sports by default).";
      case "life_brainrot_hours":
        return "Brainrot hours logged (Other + Leisure by default).";
      case "life_sleep_hours":
        return "Sleep hours logged.";
      case "life_streak":
        return "Longest run of consecutive days logged.";
      case "money_nonessential":
        return "Sum of non-essential spending in the window.";
      case "money_nonessential_pct":
        return "Non-essential ÷ income × 100.";
      case "money_total":
        return "Sum of all spending in the window.";
      case "pursuit_stat":
        return `Aggregated value of this stat across the window.`;
      default:
        return "Server-computed metric.";
    }
  })();
  const long = (() => {
    switch (metric) {
      case "life_workmax":
        return [
          "WorkMax rewards both DEPTH (what fraction of your logged time was productive vs brainrot) and VOLUME (how many productive hours). A high focus score with tiny hours doesn't beat a solid focus score with real hours, and vice versa.",
          "The formula: focus × productive hours, where focus = productive ÷ (productive + brainrot).",
          "'productive' defaults to Work + Sports slots. 'brainrot' defaults to Other + Leisure. Sleep and everything else are ignored in the ratio. You can rebucket categories in Settings; the CHALLENGE OWNER's bucket map is used for ranking so everyone plays by one rulebook.",
          `${rankLess ? "Lowest" : "Highest"} WorkMax wins. Days you didn't log score NULL, not zero -- otherwise 'log nothing' would beat 'log a real day'.`,
        ];
      case "life_focus":
        return [
          "Focus = productive ÷ (productive + brainrot) × 100. Range 0–100.",
          "Defaults: productive = Work + Sports; brainrot = Other + Leisure. Days with no productive OR brainrot logged score NULL.",
          `${rankLess ? "Lowest" : "Highest"} focus wins.`,
        ];
      case "money_nonessential":
        return [
          "The sum of all spending in categories YOU marked non-essential, across the challenge window. Essential categories (rent, groceries, bills by default) do not count against you.",
          "Amounts are hidden from other members unless you turn on 'share amounts' when joining.",
          `${rankLess ? "Lowest" : "Highest"} non-essential spend wins.`,
        ];
      case "money_nonessential_pct":
        return [
          "Non-essential spending as a % of your income. A student and a surgeon can compete fairly on the same board.",
          "Set your income under Money → Income. Percentages update as spending is logged.",
          `${rankLess ? "Lowest" : "Highest"} % wins.`,
        ];
      case "life_streak":
        return [
          "Longest unbroken run of days where you logged at least one slot.",
          "Missing a day resets the current streak but not the historical best.",
          `${rankLess ? "Shortest" : "Longest"} streak wins.`,
        ];
      default:
        return [short];
    }
  })();
  return (
    <div className="mt-2 rounded-lg border border-accent-soft bg-accent-soft/30 p-3 text-xs">
      <p className="text-muted">
        <b className="text-ink">How it&apos;s scored:</b> {short}{" "}
        <button onClick={() => setOpen((o) => !o)} className="font-medium text-accent hover:underline">
          {open ? "less" : "more"}
        </button>
      </p>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted">
          {long.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}
    </div>
  );
}

/**
 * Your own money at a glance: three lollipops -- income, essentials,
 * non-essentials -- all on the same scale so you can eyeball the
 * runway rather than reading three separate cards. Solo user's
 * headline card on Budget-Baddies-style money challenges, where the
 * comparison charts are meaningless with only one person.
 */
function YourSpendingLollipop({
  me,
  currency,
}: {
  me: Standing;
  currency?: string;
}) {
  const rows = [
    { label: "Income", value: me.income ?? 0, color: "#16a34a", hint: "Take-home this window" },
    { label: "Essential", value: me.essential ?? 0, color: "#0ea5e9", hint: "Rent, groceries, bills — the fixed side" },
    { label: "Non-essential", value: me.nonEssential ?? 0, color: "#dc2626", hint: "What you spent on discretionary things" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card p-4">
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = Math.max(2, Math.round((r.value / max) * 100));
          return (
            <div key={r.label} className="text-sm">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">{r.label}</span>
                <span className="tabular-nums font-semibold" style={{ color: r.color }}>{money(r.value, currency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-1 flex-1 rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${pct}%`, background: r.color }}
                  />
                  <div
                    className="absolute -top-1 h-3 w-3 rounded-full ring-2 ring-surface"
                    style={{ left: `calc(${pct}% - 6px)`, background: r.color }}
                  />
                </div>
              </div>
              <p className="mt-0.5 text-[10px] text-faint">{r.hint}</p>
            </div>
          );
        })}
      </div>
      {(me.income ?? 0) > 0 && (
        <p className="mt-3 border-t pt-2 text-xs text-muted">
          <b>{money((me.income ?? 0) - (me.total ?? 0), currency)}</b> left of income after all spend.
        </p>
      )}
    </div>
  );
}

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [rows, setRows] = useState<Standing[]>([]);
  const [daily, setDaily] = useState<ChallengeDay[]>([]);
  const [cats, setCats] = useState<ChallengeCategory[]>([]);
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [currency, setCur] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const today = localToday();

  // Ref so `reload()` (invoked from various handlers) sees the
  // current-challenge alive flag rather than the mount-time one.
  const aliveRef = useRef({ id, alive: true });
  function reload() {
    const token = aliveRef.current;
    setWarn(null);
    fetchChallenges()
      .then((cs) => { if (token.alive) setChallenge(cs.find((c) => c.id === id) ?? null); })
      .catch((e) => { if (token.alive) setError(String(e.message ?? e)); });
    fetchStandings(id)
      .then((r) => { if (token.alive) setRows(r); })
      .catch((e) => { if (token.alive) { setRows([]); setWarn(String(e.message ?? e)); } });
    fetchChallengeDaily(id)
      .then((d) => { if (token.alive) setDaily(d); })
      .catch((e) => { if (token.alive) { setDaily([]); setWarn(String(e.message ?? e)); } });
    // Empty is deliberate on a non-money challenge.
    fetchChallengeCategories(id)
      .then((c) => { if (token.alive) setCats(c); })
      .catch((e) => { if (token.alive) { setCats([]); setWarn(String(e.message ?? e)); } });
    fetchInvitableFriends(id)
      .then((f) => { if (token.alive) setFriends(f); })
      .catch(() => { if (token.alive) setFriends([]); });
  }
  useEffect(() => {
    // Fresh token each id -- any in-flight fetch from the previous
    // challenge is discarded when the response finally lands. Was a
    // race: quick nav between challenges let stale rows/daily/cats
    // overwrite the new page's state.
    aliveRef.current = { id, alive: true };
    reload();
    const token = aliveRef.current;
    return () => { token.alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { fetchCurrency().then(setCur).catch(() => {}); }, []);

  // "I just logged a slot, why does the challenge still say Nothing
  // logged yet?" -- because the challenge page fetched its standings
  // when it mounted and had no idea a day_entry landed on another
  // route. Two listeners fix that:
  //
  //   daymax-day-saved   fired by lib/data.ts on every upsert/delete
  //                      of a day_entry (Quick Capture, /day, /today).
  //                      Same tab, same session -> instant refresh.
  //   visibilitychange   the cross-tab case. Log on /day in one tab,
  //                      switch back to the challenge tab, and the
  //                      standings refetch as soon as that tab shows.
  //
  // Community-side caches (leaderboards, arena) also need clearing
  // because the daily race chart on this page reads them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let refreshing = false;
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      // Small debounce so a burst of upserts (catch-up mode saves
      // 4-20 slots in a row) collapses into one reload.
      setTimeout(() => {
        refreshing = false;
        import("@/lib/friends").then((f) => f.invalidateCommunityCache?.()).catch(() => {});
        reload();
      }, 250);
    };
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("daymax-day-saved", refresh);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("daymax-day-saved", refresh);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const me = rows.find((r) => r.isMe);
  const running = challenge ? challenge.startsOn <= today && challenge.endsOn >= today : false;
  const finished = challenge ? challenge.endsOn < today : false;
  const started = challenge ? challenge.startsOn <= today : false;

  const elapsed = useMemo(() => {
    if (!challenge) return 0;
    const start = new Date(challenge.startsOn + "T00:00:00").getTime();
    const end = new Date(challenge.endsOn + "T00:00:00").getTime();
    const now = new Date(today + "T00:00:00").getTime();
    return Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  }, [challenge, today]);

  // pivot the daily rows into one series per person for the race chart
  const raceData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const d of daily) {
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![d.displayName] = d.running;
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [daily]);
  const names = useMemo(() => [...new Set(daily.map((d) => d.displayName))], [daily]);

  const groupDaily = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.spent);
    return [...byDate.entries()].sort().map(([date, spent]) => ({ date, spent }));
  }, [daily]);

  const group = useMemo(() => {
    const ne = cats.filter((c) => !c.essential).reduce((s, c) => s + c.total, 0);
    const es = cats.filter((c) => c.essential).reduce((s, c) => s + c.total, 0);
    return { ne, es, total: ne + es };
  }, [cats]);

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!challenge) return <p className="text-sm text-muted">Loading…</p>;

  // --- what kind of challenge is this, in the server's own words -------------
  const canon = canonicalMetric(challenge.metric);
  const family = metricFamily(challenge.metric);
  const isMoney = family === "money";
  // Rows carry the authoritative unit/label/direction; the challenge row is the
  // fallback for a standings call that returned nothing.
  const unit = rows[0]?.scoreUnit ?? challenge.scoreUnit ?? "";
  const rankLess = rows[0]?.rankLess ?? challenge.direction === "less";
  const metricLabel = rows[0]?.scoreLabel || challenge.metricLabel || "The score";
  const noun = nounOf(metricLabel);
  const fmt = (v: number | null | undefined) => formatScore(v, unit, currency);
  /** True only when the ranked number is a SUBSET of what you log. */
  const ranksNonEssential = canon === "money_nonessential" || canon === "money_nonessential_pct";

  const logHref = isMoney ? "/money" : family === "life" ? "/day" : challenge.pursuitId ? `/pursuits/${challenge.pursuitId}` : "/pursuits";
  const logLabel = isMoney ? "Log spending →" : family === "life" ? "Log your day →" : "Log it →";

  // --- how much of this board is actually empty, and why ---------------------
  const totalEntries = rows.reduce((s, r) => s + r.entries, 0);
  const scoreTotal = rows.reduce((s, r) => s + (r.score ?? 0), 0);
  const scoredRows = rows.filter((r) => r.score != null);
  // Group totals are aggregate and always visible; my own row is always visible
  // to me. Between them we can name a figure in the banner even when everyone
  // else keeps their amounts private.
  const loggedMoney = group.total > 0 ? group.total : me?.total ?? 0;
  const loggedLabel = loggedMoney > 0 ? money(loggedMoney, currency) : undefined;
  /**
   * The case this whole page was built around: real spending, all of it filed
   * essential, so the number every chart plots is zero. Correct arithmetic,
   * six blank grids.
   */
  const allEssential = ranksNonEssential && totalEntries > 0 && scoreTotal === 0;
  const raceMagnitude = daily.reduce((s, d) => Math.max(s, Math.abs(d.running)), 0);
  const dailyMagnitude = groupDaily.reduce((s, d) => s + Math.abs(d.spent), 0);

  /** Shared context for every chart on the board. */
  const base = { started, members: rows.length, entries: totalEntries };

  const leader = scoredRows[0];
  // Rows arrive leader-first whichever way the metric runs, so the person at
  // the other end is the LAST scored row — not "the biggest number", which was
  // only the loser back when every challenge was "least spending wins".
  const trailing = scoredRows.length > 1 ? scoredRows[scoredRows.length - 1] : undefined;
  /**
   * How far behind the last-placed member is, as a percentage OF THE LEADER —
   * which is the only base that reads correctly in both directions. "40 vs 100
   * on least-spending" is 150% more than the leader; "31 vs 20 on most WorkMax"
   * is 35% less than the leader, not 55%.
   */
  const gap = (() => {
    if (!leader || !trailing) return null;
    const a = leader.score ?? 0;
    const b = trailing.score ?? 0;
    if (a <= 0 || a === b) return null;
    return { pct: Math.round((Math.abs(b - a) / a) * 100), word: b > a ? "more" : "less" };
  })();

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      {warn && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{warn}</p>}

      {/* Roster at the VERY top, before the header card, so who's in
          is the first thing you land on. Feedback: "at the very top
          have the members in the challenge". */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
            {rosterNoun(challenge.name)} · {rows.length}
          </span>
          {rows.map((r) => (
            <Link
              key={r.userId}
              href={r.isMe ? "/profile" : `/friends/${r.userId}`}
              className={`inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 text-xs transition hover:-translate-y-0.5 hover:text-accent ${r.isMe ? "border-accent text-accent" : ""}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: `color-mix(in srgb, var(--accent) 20%, transparent)` }}>
                {r.displayName.slice(0, 1).toUpperCase()}
              </span>
              {r.displayName}
              {r.isMe && <span className="text-[9px] text-faint">you</span>}
            </Link>
          ))}
        </div>
      )}

      {/* header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{challenge.name}</h1>
          {running && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-contrast">LIVE</span>}
          {finished && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">FINISHED</span>}
        </div>
        <p className="mt-1 text-sm text-muted">{challenge.description}</p>
        <p className="mt-2 text-xs font-medium text-accent">{metricLabel} wins</p>
        <MetricRules metric={canon} rankLess={rankLess} />

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-faint">
            <span>{challenge.startsOn}</span>
            <span>{running ? `${challenge.daysLeft} days left` : finished ? "over" : "not started"}</span>
            <span>{challenge.endsOn}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${elapsed * 100}%` }} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!challenge.isMember && !finished && (
            <button
              onClick={() => {
                setBusy(true);
                joinChallenge(id).then(reload).catch((e) => setError(String(e.message ?? e))).finally(() => setBusy(false));
              }}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "Joining…" : "Join challenge"}
            </button>
          )}
          {challenge.isMember && (
            <>
              <Link href={logHref} className="btn-primary">{logLabel}</Link>
              <button onClick={() => setShowInvite(!showInvite)} className="btn-ghost">Invite friends</button>
              <button onClick={() => void leaveChallenge(id).then(reload)} className="btn-ghost text-xs">Leave</button>
            </>
          )}
        </div>

      </div>

      {/* ONE diagnosis, at the top, for whatever is hollowing out the board.
          Ordered by what the reader has to fix first — there is no point
          telling someone their charts are thin when nothing has been logged. */}
      {challenge.isMember && (
        <BoardDiagnosis
          started={started}
          entries={totalEntries}
          allEssential={allEssential}
          loggedLabel={loggedLabel}
          members={rows.length}
          scored={scoredRows.length}
          startsOn={challenge.startsOn}
          noun={noun}
          logHref={logHref}
        />
      )}

      {/* invite: friends first, link as the fallback */}
      {showInvite && challenge.isMember && (
        <div className="card p-4">
          <h2 className="mb-1 font-semibold">Invite friends</h2>
          <p className="mb-3 text-sm text-muted">
            They get an invitation to accept — nobody is added to a challenge without saying yes.
          </p>
          {friends.length === 0 ? (
            <p className="text-sm text-faint">
              No friends left to invite. <Link href="/search" className="font-medium text-accent hover:underline">Add some →</Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {friends.map((f) => (
                <button
                  key={f.memberId}
                  disabled={f.invited}
                  onClick={() => void inviteFriend(id, f.memberId).then(reload)}
                  className={`rounded-full border px-3 py-2 text-sm ${
                    f.invited ? "bg-surface-2 text-faint" : "bg-surface hover:text-accent"
                  }`}
                >
                  {f.invited ? "✓ " : "+ "}
                  {f.displayName}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 border-t pt-3">
            <button
              onClick={() => {
                const url = `${location.origin}/challenges/${id}`;
                navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
                if (navigator.share) navigator.share({ title: challenge.name, url }).catch(() => {});
              }}
              className="text-sm font-medium text-accent hover:underline"
            >
              {copied ? "Link copied ✓" : "Or copy a link for someone not on DayMax"}
            </button>
          </div>
        </div>
      )}

      {!challenge.isMember && (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">What joining shares</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              Your <b>{noun}</b> over this window becomes visible to other members. That&apos;s the ranking.
            </li>
            {isMoney ? (
              <>
                <li>Dollar breakdowns stay <b>private unless you switch them on</b>.</li>
                <li>Individual purchases are never shared — only totals and category names.</li>
              </>
            ) : (
              <li>
                Nothing else is read. This challenge doesn&apos;t touch your spending, and joining it publishes no
                money figures at all.
              </li>
            )}
            <li>Nobody outside the challenge sees anything.</li>
          </ul>
        </div>
      )}

      {/* your own numbers */}
      {challenge.isMember && me && isMoney && (
        <YouCard challengeId={id} me={me} rows={rows} currency={currency} metricLabel={metricLabel} unit={unit} onChanged={reload} />
      )}
      {challenge.isMember && me && !isMoney && (
        <YouScore me={me} rank={rows.findIndex((r) => r.isMe) + 1} metricLabel={metricLabel} fmt={fmt} unit={unit} logHref={logHref} />
      )}

      {/* the headline story. Suppressed when the leader is on nothing: "X is
          winning on $0.00" is the same empty chart in sentence form. */}
      {rows.length > 1 && leader && (leader.score ?? 0) !== 0 && (
        <div className="card p-4">
          <p className="text-sm">
            <b>{leader.displayName}</b> is winning on {fmt(leader.score)} of {noun}
            {trailing && trailing.userId !== leader.userId && (
              <> — <b>{trailing.displayName}</b> is on {fmt(trailing.score)}
                {gap ? `, ${gap.pct}% ${gap.word}` : ""}</>
            )}.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <section>
            <h2 className="mb-1 font-semibold">{finished ? "Final standings" : "Standings"}</h2>
            <p className="mb-2 text-sm text-muted">{metricLabel} wins. Updates as people log.</p>
            <div className="card divide-y">
              {rows.map((r, i) => (
                <div key={r.userId} className={`px-3 py-3 ${r.isMe ? "bg-accent-soft/30" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-center text-lg font-bold text-faint">
                      {r.score == null ? "–" : i === 0 ? "👑" : i + 1}
                    </span>
                    <Link href={`/friends/${r.userId}`} className="inline-flex items-center gap-1.5 font-medium hover:text-accent hover:underline">
                      {r.displayName}
                      <TeamDot team={r.team} />
                    </Link>
                    {r.isMe && <span className="text-xs text-accent">you</span>}
                    <span className="ml-auto text-lg font-bold tabular-nums">
                      {formatScore(r.score, r.scoreUnit || unit, currency)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-8 text-xs text-faint">
                    {/* Every one of these is a money column. The server sends
                        NULL for all of them on a non-money challenge, so they
                        hide rather than print "—" five times. */}
                    {isMoney && <span>{r.pct != null ? <>{r.pct}% of income</> : "no income set"}</span>}
                    {/* per_day is NULL for focus and streak, where a daily
                        average is meaningless. money.ts coerces that to 0. */}
                    {r.perDay > 0 && <span>{formatScore(r.perDay, r.scoreUnit || unit, currency)}/day</span>}
                    {isMoney && r.topCategory && <span>most on {r.topCategory}</span>}
                    <span>{r.entries} logged</span>
                    {isMoney && !r.sharesAmounts && !r.isMe && <span className="italic">amounts private</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* GRAPHS. Two layouts:

              LIFE challenges (Grindset Goblins, sleep, etc) get three
              tiles: the group's typical day as a single clock, then
              everyone's day as vertical 24-hour columns side-by-side,
              then the race. Laid out as a real grid so they sit next
              to each other on wide screens and stack on phones; the
              old horizontal snap-carousel forced a swipe-per-graph
              even when both fit at once.

              MONEY / STAT challenges keep the money-specific pie +
              share-of-income + daily-damage set, since those views
              are what the metric is actually about, and stay in the
              carousel because there are more of them. */}
          <section>
            <h2 className="mb-2 font-semibold">Graphs</h2>
            {family === "life" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <AverageDayClock
                    members={rows.map((r) => ({ id: r.userId, name: r.displayName }))}
                    from={challenge.startsOn}
                    to={challenge.endsOn}
                  />
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Everyone&apos;s day, side by side</h3>
                  <MembersDayColumns
                    members={rows.map((r) => ({ id: r.userId, name: r.displayName }))}
                    from={challenge.startsOn}
                    to={challenge.endsOn}
                  />
                </div>

                {/* Horizontal lollipops of per-person hours in each
                    bucket, scoped strictly to the challenge window
                    (server-side via member_day_strip). Sized to
                    match the Average Day clock cell so the picture
                    balances on either side of the grid. */}
                <div className="md:col-start-1">
                  <h3 className="mb-2 font-semibold">Hours by person</h3>
                  <MembersHoursBars
                    members={rows.map((r) => ({ id: r.userId, name: r.displayName }))}
                    from={challenge.startsOn}
                    to={challenge.endsOn}
                    maxWidth={360}
                  />
                </div>

                {/* The race is hidden entirely on life challenges
                    until there is real data to plot -- >=2 days
                    with something in the race, non-zero total, and
                    someone actually running. */}
                {raceData.length >= 2 && raceMagnitude > 0 && (
                  <div className="md:col-span-2">
                    <h3 className="mb-2 font-semibold">
                      The race
                      <span className="ml-2 text-xs font-normal text-muted">
                        Running {noun}. {rankLess ? "Flattest" : "Highest"} line wins.
                      </span>
                    </h3>
                    <div className="h-36 card p-2">
                      <ResponsiveContainer>
                        <LineChart data={raceData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v: number) => fmt(Number(v))} labelFormatter={(d) => String(d)} />
                          <Legend />
                          {names.map((n, i) => (
                            <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} dot={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Money / stat branch. Every card renders ONLY when it
                 has real data -- the old snap-carousel forced empty
                 placeholders through, which showed 'no race yet' and
                 half a dozen 'nothing plotted' cards on a solo
                 challenge with three receipts. Grid layout matches
                 the life branch: side-by-side on wide screens,
                 stacks on phones. */
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* YOUR spending, broken out. Always renders once
                    you've logged anything, so a solo user still
                    gets a picture. Lollipop rather than pie so
                    income sits alongside the two spend rails at the
                    same scale. */}
                {isMoney && me && ((me.essential ?? 0) + (me.nonEssential ?? 0) + (me.income ?? 0) > 0) && (
                  <div>
                    <h3 className="mb-2 font-semibold">Your spending</h3>
                    <YourSpendingLollipop me={me} currency={currency} />
                  </div>
                )}

                {/* Essentials list. Solo-friendly: no pie when
                    you're the only member (a pie of one slice reads
                    as noise), just the compact list with per-head
                    totals and the duplicate-hint chip. */}
                {isMoney && cats.some((c) => c.essential) && (() => {
                  const ess = cats.filter((c) => c.essential);
                  const perPerson = ess.map((c) => (c.people > 0 ? c.total / c.people : 0)).filter((v) => v > 0);
                  const median = perPerson.length > 0
                    ? [...perPerson].sort((a, b) => a - b)[Math.floor(perPerson.length / 2)]
                    : 0;
                  const flag = (c: ChallengeCategory) =>
                    c.people > 0 && median > 0 && c.total / c.people >= median * 2;
                  const flagged = ess.filter(flag);
                  return (
                    <div>
                      <h3 className="mb-2 font-semibold">Essentials</h3>
                      {flagged.length > 0 && (
                        <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                          <b>Heads up:</b> per-person spend on <b>{flagged.map((c) => c.name).join(", ")}</b> is
                          well above the median. Worth checking for a doubled-up entry.
                        </p>
                      )}
                      {/* Pie + list side-by-side ALWAYS -- was solo-only-hidden
                          before, but a pie of one person's essentials still
                          answers 'where does my fixed cost live' cleanly. */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="h-56 card p-2">
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie data={ess.slice(0, 8)} dataKey="total" nameKey="name" label={(p: any) => p.name}>
                                {ess.slice(0, 8).map((_, i) => (
                                  <Cell key={i} fill={SERIES[i % SERIES.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: number) => money(Number(v), currency)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="card divide-y">
                          {ess.slice(0, 8).map((c) => (
                            <div key={c.name} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                              <span className="min-w-0 flex-1 truncate">
                                {c.name}
                                {flag(c) && (
                                  <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[9px] font-semibold text-warn">
                                    2× median
                                  </span>
                                )}
                              </span>
                              <span className="tabular-nums font-semibold">{money(c.total, currency)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Non-essentials breakdown. Renders whenever there
                    is data, solo included -- 'where did my
                    discretionary spend go' is a fair question with
                    one person too. Heading changes to reflect
                    whether it's 'the group' or just 'you'. */}
                {isMoney && cats.some((c) => !c.essential) && group.ne > 0 && (
                  <div className="md:col-span-2">
                    <h3 className="mb-1 font-semibold">
                      {rows.length > 1 ? "What the group is spending on" : "Where your non-essentials went"}
                    </h3>
                    <p className="mb-2 text-sm text-muted">
                      {rows.length > 1
                        ? <>Everyone combined — {money(group.ne, currency)} non-essential against {money(group.es, currency)} essential.</>
                        : <>{money(group.ne, currency)} in discretionary spending this window.</>}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="h-60 card p-2">
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie data={cats.filter((c) => !c.essential).slice(0, 8)} dataKey="total" nameKey="name" label={(p: any) => p.name}>
                              {cats.filter((c) => !c.essential).slice(0, 8).map((_, i) => (
                                <Cell key={i} fill={SERIES[i % SERIES.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => money(Number(v), currency)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="card divide-y">
                        {cats.filter((c) => !c.essential).slice(0, 8).map((c) => (
                          <div key={c.name} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className="tabular-nums font-semibold">{money(c.total, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* The race. Only when >=2 days and someone's
                    moving. */}
                {raceData.length >= 2 && raceMagnitude > 0 && rows.length > 1 && (
                  <div className="md:col-span-2">
                    <h3 className="mb-2 font-semibold">
                      The race
                      <span className="ml-2 text-xs font-normal text-muted">
                        Running {noun}. {rankLess ? "Flattest" : "Highest"} line wins.
                      </span>
                    </h3>
                    <div className="h-36 card p-2">
                      <ResponsiveContainer>
                        <LineChart data={raceData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v: number) => fmt(Number(v))} labelFormatter={(d) => String(d)} />
                          <Legend />
                          {names.map((n, i) => (
                            <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} dot={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Score-by-person bar and %-of-income bar: only
                    meaningful once there's someone to compare
                    against. Hidden when solo. */}
                {rows.length > 1 && scoreTotal > 0 && (
                  <div>
                    <h3 className="mb-2 font-semibold">{unit === "currency" ? "In dollars" : sentenceCase(noun)}</h3>
                    <div className="h-56 card p-2">
                      <ResponsiveContainer>
                        <BarChart data={rows.map((r) => ({ name: r.displayName, score: r.score ?? 0 }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v: number) => fmt(Number(v))} />
                          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                            {rows.map((r, i) => (
                              <Cell key={r.userId} fill={i === 0 ? "#16a34a" : teamMeta(r.team).color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {isMoney && rows.length > 1 && rows.some((r) => r.pct != null && r.pct > 0) && (
                  <div>
                    <h3 className="mb-2 font-semibold">As a share of income</h3>
                    <div className="h-56 card p-2">
                      <ResponsiveContainer>
                        <BarChart data={rows.filter((r) => r.pct != null).map((r) => ({ name: r.displayName, pct: r.pct }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} unit="%" />
                          <Tooltip formatter={(v: number) => `${v}% of income`} />
                          <Bar dataKey="pct" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Daily damage. >=2 days and some magnitude. */}
                {groupDaily.length >= 2 && dailyMagnitude > 0 && (
                  <div className="md:col-span-2">
                    <h3 className="mb-2 font-semibold">{isMoney ? "Daily damage, everyone combined" : "Day by day, everyone combined"}</h3>
                    <div className="h-40 card p-2">
                      <ResponsiveContainer>
                        <AreaChart data={groupDaily}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v: number) => fmt(Number(v))} />
                          <Area
                            type="monotone"
                            dataKey="spent"
                            stroke={rankLess ? "#dc2626" : "#16a34a"}
                            fill={rankLess ? "#dc2626" : "#16a34a"}
                            fillOpacity={0.18}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>{/* /Graphs */}
        </>
      )}

      {challenge.isMember && rows.length <= 1 && (
        <p className="card p-4 text-sm text-faint">
          Nobody else has joined yet. Hit <b>Invite friends</b> above — the leaderboard gets a lot more interesting
          with two people on it.
        </p>
      )}

      {/* Daily feed: one thread per day of the challenge. Only shown
          once the challenge is joined (non-members see leaderboards
          only, not the group chat). Runs on Phase 2 tables from
          migration 0041 (challenge_posts + comments + reactions +
          storage bucket). */}
      {/* Feed is shared with life challenges: same ChallengeFeed
          component, same props shape. Any money-vs-life visual
          difference before this commit was because the me prop was
          hardcoded to null -- own-post controls (delete, own tag)
          didn't light up because the feed couldn't tell it was you.
          Fixed by threading the current user id through from the
          standings row. */}
      {challenge.isMember && (
        <ChallengeFeed
          challengeId={id}
          startsOn={challenge.startsOn}
          endsOn={challenge.endsOn}
          me={me?.userId ?? null}
          isMember={challenge.isMember}
        />
      )}
    </div>
  );
}

