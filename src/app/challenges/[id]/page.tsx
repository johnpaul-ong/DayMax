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
import { useEffect, useMemo, useState } from "react";
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
  setIncomeOverride,
  setShareAmounts,
  type Challenge,
  type ChallengeCategory,
  type ChallengeDay,
  type InvitableFriend,
  type Standing,
} from "@/lib/money";
import { teamMeta } from "@/lib/teams";
import { TeamDot } from "../../team-name";
import { BoardNotice, ChartEmpty, emptyCause, type EmptyCause } from "../../empty-chart";

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

  function reload() {
    setWarn(null);
    fetchChallenges()
      .then((cs) => setChallenge(cs.find((c) => c.id === id) ?? null))
      .catch((e) => setError(String(e.message ?? e)));
    fetchStandings(id).then(setRows).catch((e) => { setRows([]); setWarn(String(e.message ?? e)); });
    // A missing migration used to fail silently here, which read as "no graphs
    // were updated" rather than "this function does not exist yet".
    fetchChallengeDaily(id).then(setDaily).catch((e) => { setDaily([]); setWarn(String(e.message ?? e)); });
    // Empty is the correct, deliberate answer on a non-money challenge — the
    // spend tables are not read. It is not an error and must not warn.
    fetchChallengeCategories(id).then(setCats).catch((e) => { setCats([]); setWarn(String(e.message ?? e)); });
    fetchInvitableFriends(id).then(setFriends).catch(() => setFriends([]));
  }
  useEffect(reload, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCurrency().then(setCur).catch(() => {}); }, []);

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

      {/* header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{challenge.name}</h1>
          {running && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-contrast">LIVE</span>}
          {finished && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">FINISHED</span>}
        </div>
        <p className="mt-1 text-sm text-muted">{challenge.description}</p>
        <p className="mt-2 text-xs font-medium text-accent">{metricLabel} wins</p>

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
        <YouCard challengeId={id} me={me} currency={currency} metricLabel={metricLabel} unit={unit} onChanged={reload} />
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

          {/* the race */}
          <Guarded
            title="The race"
            sub={`Running ${noun}. ${rankLess ? "Flattest" : "Highest"} line wins.`}
            cause={emptyCause({
              ...base,
              plotted: raceMagnitude,
              logged: isMoney ? loggedMoney : undefined,
              moneySubset: ranksNonEssential,
              days: raceData.length,
              minDays: 2,
            })}
            noun={noun}
            loggedLabel={loggedLabel}
            startsOn={challenge.startsOn}
            days={raceData.length}
            action={{ href: logHref, label: logLabel }}
          >
            <div className="h-64 card p-2">
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
          </Guarded>

          {/* side by side, and — on money only — the same thing over income */}
          <section className={isMoney ? "grid gap-4 sm:grid-cols-2" : ""}>
            <Guarded
              small
              title={unit === "currency" ? "In dollars" : sentenceCase(noun)}
              cause={emptyCause({
                ...base,
                comparesPeople: true,
                plotted: scoreTotal,
                logged: isMoney ? loggedMoney : undefined,
                moneySubset: ranksNonEssential,
              })}
              noun={noun}
              loggedLabel={loggedLabel}
              startsOn={challenge.startsOn}
              action={{ href: logHref, label: logLabel }}
            >
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
            </Guarded>

            {/* % of income only exists for money challenges — challenge_income()
                is not even consulted for the others. */}
            {isMoney && (
              <div>
                <Guarded
                  small
                  title="As a share of income"
                  cause={emptyCause({
                    ...base,
                    comparesPeople: true,
                    income: rows.some((r) => r.pct != null) ? 1 : 0,
                    plotted: rows.reduce((s, r) => s + (r.pct ?? 0), 0),
                    logged: loggedMoney,
                    moneySubset: ranksNonEssential,
                  })}
                  noun="spending as a share of income"
                  loggedLabel={loggedLabel}
                  startsOn={challenge.startsOn}
                  action={{ href: "/money", label: "Add your income →" }}
                >
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
                </Guarded>
                {canon === "money_nonessential" && (
                  <p className="mt-1 text-xs text-faint">
                    Rankings use dollars, but this is the fairer comparison across different incomes.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* What the group is spending on. challenge_categories() returns
              nothing at all for a non-money challenge, by design — joining a
              sleep challenge must not publish your spending — so this section
              is absent rather than empty for those. */}
          {isMoney && (
            <section>
              <h2 className="mb-1 font-semibold">What the group is spending on</h2>
              {cats.length > 0 && (
                <p className="mb-2 text-sm text-muted">
                  Everyone combined — {money(group.ne, currency)} non-essential against {money(group.es, currency)} essential.
                  Nobody&apos;s individual spending is shown here.
                </p>
              )}
              {group.ne === 0 ? (
                <ChartEmpty
                  cause={emptyCause({ ...base, plotted: group.ne, logged: group.total, moneySubset: true }) ?? "no-data"}
                  noun="non-essential spending"
                  loggedLabel={loggedLabel}
                  startsOn={challenge.startsOn}
                  action={{ href: "/money", label: "Review your categories →" }}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="h-60 card p-2">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={cats.filter((c) => !c.essential).slice(0, 8)}
                          dataKey="total"
                          nameKey="name"
                          label={(p: any) => p.name}
                        >
                          {cats.filter((c) => !c.essential).slice(0, 8).map((_, i) => (
                            <Cell key={i} fill={SERIES[i % SERIES.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => money(Number(v), currency)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card divide-y">
                    {cats.filter((c) => !c.essential).slice(0, 7).map((c) => (
                      <div key={c.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="text-xs text-faint">{c.people} {c.people === 1 ? "person" : "people"}</span>
                        <span className="tabular-nums font-semibold">{money(c.total, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* group pace over time */}
          <Guarded
            title={isMoney ? "Daily damage, everyone combined" : "Day by day, everyone combined"}
            cause={emptyCause({
              ...base,
              plotted: dailyMagnitude,
              logged: isMoney ? loggedMoney : undefined,
              moneySubset: ranksNonEssential,
              days: groupDaily.length,
              minDays: 2,
            })}
            noun={noun}
            loggedLabel={loggedLabel}
            startsOn={challenge.startsOn}
            days={groupDaily.length}
            action={{ href: logHref, label: logLabel }}
          >
            <div className="h-52 card p-2">
              <ResponsiveContainer>
                <AreaChart data={groupDaily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(Number(v))} />
                  {/* red when you want less of it, green when you want more */}
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
          </Guarded>
        </>
      )}

      {challenge.isMember && rows.length <= 1 && (
        <p className="card p-4 text-sm text-faint">
          Nobody else has joined yet. Hit <b>Invite friends</b> above — the leaderboard gets a lot more interesting
          with two people on it.
        </p>
      )}
    </div>
  );
}

/**
 * A chart, or the reason there isn't one. `cause` of null means draw it.
 *
 * The heading survives either way: a section that vanishes entirely reads as a
 * bug on a page you looked at yesterday, and the whole point is to say what
 * changed.
 */
function Guarded({
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

/**
 * The one banner. Every chart below can work out its own emptiness, but six
 * copies of "it's all essential" is six times worse than one, so the dominant
 * cause is stated here and the charts below say the short version.
 */
function BoardDiagnosis({
  started,
  entries,
  allEssential,
  loggedLabel,
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

  // The case that produced six blank grids.
  if (allEssential)
    return (
      <BoardNotice
        title="Everything you've logged is marked essential"
        action={{ href: "/money", label: "Open Money → Categories →" }}
      >
        {loggedLabel ? <>All {loggedLabel} of it.</> : null} This challenge ranks{" "}
        <b>non-essential</b> spending, and yours comes to zero — which is why the charts below have nothing in them.
        If rent and groceries really are all you logged, that&apos;s a clean scoreboard. If not, flip the categories
        you disagree with: it only changes things for you.
      </BoardNotice>
    );

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
function YouScore({
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
      <p className="mt-3 border-t pt-3 text-xs text-faint">
        This challenge doesn&apos;t read your spending — no money figures are shared by being in it.
      </p>
    </div>
  );
}

/** Your own numbers, and the income baseline you can nudge. Money only. */
function YouCard({
  challengeId,
  me,
  currency,
  metricLabel,
  unit,
  onChanged,
}: {
  challengeId: string;
  me: Standing;
  currency?: string;
  metricLabel: string;
  unit: string;
  onChanged: () => void;
}) {
  const [income, setIncome] = useState(me.income != null ? String(me.income) : "");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the field was initialised once and then ignored whatever the server said,
  // so a saved value never appeared and it looked like nothing had happened
  useEffect(() => {
    setIncome(me.income != null ? String(me.income) : "");
  }, [me.income]);

  const m = (v: number | null | undefined) => money(v, currency);
  const pctOf = (v: number | null) =>
    me.income != null && me.income > 0 && v != null ? Math.round((v / me.income) * 1000) / 10 : null;
  const essPct = pctOf(me.essential);
  const totPct = pctOf(me.total);
  const left = me.income != null && me.total != null ? me.income - me.total : null;
  const noEssentialAtAll = (me.total ?? 0) > 0 && (me.nonEssential ?? 0) === 0;

  return (
    <div className="card p-4">
      <h2 className="mb-2 font-semibold">You</h2>
      {/* Income was only ever divided into non-essential spend, so with £0 of
          non-essential it showed "0% of income" and looked like the income
          setting did nothing. It works; it was multiplying zero. Income now
          appears against every figure, and the bar shows what is left of it. */}
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-3xl font-bold tabular-nums">{m(me.nonEssential)}</p>
          <p className="text-xs text-muted">
            non-essential{me.pct != null && <> · <b>{me.pct}%</b> of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{m(me.essential)}</p>
          <p className="text-xs text-muted">
            essential{essPct != null && <> · {essPct}% of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{m(me.total)}</p>
          <p className="text-xs text-muted">
            all spending{totPct != null && <> · {totPct}% of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{m(me.perDay)}</p>
          <p className="text-xs text-muted">a day</p>
        </div>
        {left != null && (
          <div>
            <p className="text-3xl font-bold tabular-nums text-ok">{m(left)}</p>
            <p className="text-xs text-muted">still unspent</p>
          </div>
        )}
      </div>

      {noEssentialAtAll && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          All of it is filed essential, so your ranked score is {formatScore(0, unit, currency)}. Tap a category under{" "}
          <Link href="/money" className="font-medium underline">Money → Categories</Link> to move something across.
        </p>
      )}

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
          {/* This used to name Budget Baddies and dollars outright; it is the
              metric that decides whether income moves the ranking, not the
              challenge's name. */}
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
