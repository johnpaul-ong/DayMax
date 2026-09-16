"use client";

/**
 * A challenge board that's worth opening twice a day.
 *
 * Ranked on the raw number people actually argue about — least non-essential
 * spend — with percentage of income, category splits, daily pace and a race
 * chart alongside. Rank on the number they care about; inform with the rest.
 *
 * Privacy shape: joining shares your position. Dollar amounts are opt-in and
 * off by default, so the table shows "private" rather than a number for anyone
 * who hasn't switched them on. They still rank.
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
  fetchChallengeCategories,
  fetchChallengeDaily,
  fetchChallenges,
  fetchInvitableFriends,
  fetchStandings,
  inviteFriend,
  joinChallenge,
  leaveChallenge,
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

const SERIES = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tick = (d: string) => (typeof d === "string" ? d.slice(5) : d);

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [rows, setRows] = useState<Standing[]>([]);
  const [daily, setDaily] = useState<ChallengeDay[]>([]);
  const [cats, setCats] = useState<ChallengeCategory[]>([]);
  const [friends, setFriends] = useState<InvitableFriend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
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
    fetchChallengeCategories(id).then(setCats).catch((e) => { setCats([]); setWarn(String(e.message ?? e)); });
    fetchInvitableFriends(id).then(setFriends).catch(() => setFriends([]));
  }
  useEffect(reload, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = rows.find((r) => r.isMe);
  const running = challenge ? challenge.startsOn <= today && challenge.endsOn >= today : false;
  const finished = challenge ? challenge.endsOn < today : false;

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

  const group = useMemo(() => {
    const ne = cats.filter((c) => !c.essential).reduce((s, c) => s + c.total, 0);
    const es = cats.filter((c) => c.essential).reduce((s, c) => s + c.total, 0);
    return { ne, es, total: ne + es };
  }, [cats]);

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!challenge) return <p className="text-sm text-muted">Loading…</p>;

  const leader = rows[0];
  const biggest = [...rows].filter((r) => r.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

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
              <Link href="/money" className="btn-primary">Log spending →</Link>
              <button onClick={() => setShowInvite(!showInvite)} className="btn-ghost">Invite friends</button>
              <button onClick={() => void leaveChallenge(id).then(reload)} className="btn-ghost text-xs">Leave</button>
            </>
          )}
        </div>
      </div>

      {/* invite: friends first, link as the fallback */}
      {showInvite && challenge.isMember && (
        <div className="card p-4">
          <h2 className="mb-1 font-semibold">Invite friends</h2>
          <p className="mb-3 text-sm text-muted">
            They get an invitation to accept — nobody is added to a money challenge without saying yes.
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
            <li>Your <b>non-essential spending total</b> becomes visible to other members. That&apos;s the ranking.</li>
            <li>Dollar breakdowns stay <b>private unless you switch them on</b>.</li>
            <li>Individual purchases are never shared — only totals and category names.</li>
            <li>Nobody outside the challenge sees anything.</li>
          </ul>
        </div>
      )}

      {/* your own numbers, plus the income dial */}
      {challenge.isMember && me && (
        <YouCard challengeId={id} me={me} onChanged={reload} />
      )}

      {/* the headline story */}
      {rows.length > 1 && leader && (
        <div className="card p-4">
          <p className="text-sm">
            <b>{leader.displayName}</b> is winning on {money(leader.score)} of non-essential spending
            {biggest && biggest.userId !== leader.userId && (
              <> — <b>{biggest.displayName}</b> has spent {money(biggest.score)}, {
                leader.score && leader.score > 0 && biggest.score
                  ? `${Math.round((biggest.score / leader.score - 1) * 100)}% more`
                  : "rather more"
              }</>
            )}.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <section>
            <h2 className="mb-1 font-semibold">{finished ? "Final standings" : "Standings"}</h2>
            <p className="mb-2 text-sm text-muted">Least non-essential spending wins. Updates as people log.</p>
            <div className="card divide-y">
              {rows.map((r, i) => (
                <div key={r.userId} className={`px-3 py-3 ${r.isMe ? "bg-accent-soft/30" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-center text-lg font-bold text-faint">
                      {i === 0 ? "👑" : i + 1}
                    </span>
                    <Link href={`/friends/${r.userId}`} className="inline-flex items-center gap-1.5 font-medium hover:text-accent hover:underline">
                      {r.displayName}
                      <TeamDot team={r.team} />
                    </Link>
                    {r.isMe && <span className="text-xs text-accent">you</span>}
                    <span className="ml-auto text-lg font-bold tabular-nums">{money(r.score)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-8 text-xs text-faint">
                    <span>{r.pct != null ? <>{r.pct}% of income</> : "no income set"}</span>
                    <span>{money(r.perDay)}/day</span>
                    {r.topCategory && <span>most on {r.topCategory}</span>}
                    <span>{r.entries} logged</span>
                    {!r.sharesAmounts && !r.isMe && <span className="italic">amounts private</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* the race */}
          {raceData.length > 1 && (
            <section>
              <h2 className="mb-1 font-semibold">The race</h2>
              <p className="mb-2 text-sm text-muted">Running total of non-essential spend. Flattest line wins.</p>
              <div className="h-64 card p-2">
                <ResponsiveContainer>
                  <LineChart data={raceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => money(Number(v))} labelFormatter={(d) => String(d)} />
                    <Legend />
                    {names.map((n, i) => (
                      <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* dollars vs percent, side by side — two honest views of the same thing */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold">In dollars</h3>
              <div className="h-56 card p-2">
                <ResponsiveContainer>
                  <BarChart data={rows.map((r) => ({ name: r.displayName, spent: r.score ?? 0 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => money(Number(v))} />
                    <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                      {rows.map((r, i) => (
                        <Cell key={r.userId} fill={i === 0 ? "#16a34a" : teamMeta(r.team).color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">As a share of income</h3>
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
              <p className="mt-1 text-xs text-faint">
                Rankings use dollars, but this is the fairer comparison across different incomes.
              </p>
            </div>
          </section>

          {/* what the group is blowing it on */}
          {cats.length > 0 && (
            <section>
              <h2 className="mb-1 font-semibold">What the group is spending on</h2>
              <p className="mb-2 text-sm text-muted">
                Everyone combined — {money(group.ne)} non-essential against {money(group.es)} essential.
                Nobody&apos;s individual spending is shown here.
              </p>
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
                      <Tooltip formatter={(v: number) => money(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="card divide-y">
                  {cats.filter((c) => !c.essential).slice(0, 7).map((c) => (
                    <div key={c.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-faint">{c.people} {c.people === 1 ? "person" : "people"}</span>
                      <span className="tabular-nums font-semibold">{money(c.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* group pace over time */}
          {raceData.length > 1 && (
            <section>
              <h2 className="mb-1 font-semibold">Daily damage, everyone combined</h2>
              <div className="h-52 card p-2">
                <ResponsiveContainer>
                  <AreaChart
                    data={(() => {
                      const byDate = new Map<string, number>();
                      for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.spent);
                      return [...byDate.entries()].sort().map(([date, spent]) => ({ date, spent }));
                    })()}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tick} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => money(Number(v))} />
                    <Area type="monotone" dataKey="spent" stroke="#dc2626" fill="#dc2626" fillOpacity={0.18} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
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

/** Your own numbers, and the income baseline you can nudge. */
function YouCard({ challengeId, me, onChanged }: { challengeId: string; me: Standing; onChanged: () => void }) {
  const [income, setIncome] = useState(me.income != null ? String(me.income) : "");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the field was initialised once and then ignored whatever the server said,
  // so a saved value never appeared and it looked like nothing had happened
  useEffect(() => {
    setIncome(me.income != null ? String(me.income) : "");
  }, [me.income]);

  const pctOf = (v: number | null) =>
    me.income != null && me.income > 0 && v != null ? Math.round((v / me.income) * 1000) / 10 : null;
  const essPct = pctOf(me.essential);
  const totPct = pctOf(me.total);
  const left = me.income != null && me.total != null ? me.income - me.total : null;

  return (
    <div className="card p-4">
      <h2 className="mb-2 font-semibold">You</h2>
      {/* Income was only ever divided into non-essential spend, so with £0 of
          non-essential it showed "0% of income" and looked like the income
          setting did nothing. It works; it was multiplying zero. Income now
          appears against every figure, and the bar shows what is left of it. */}
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-3xl font-bold tabular-nums">{money(me.nonEssential)}</p>
          <p className="text-xs text-muted">
            non-essential{me.pct != null && <> · <b>{me.pct}%</b> of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{money(me.essential)}</p>
          <p className="text-xs text-muted">
            essential{essPct != null && <> · {essPct}% of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{money(me.total)}</p>
          <p className="text-xs text-muted">
            all spending{totPct != null && <> · {totPct}% of income</>}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums">{money(me.perDay)}</p>
          <p className="text-xs text-muted">a day</p>
        </div>
        {left != null && (
          <div>
            <p className="text-3xl font-bold tabular-nums text-ok">{money(left)}</p>
            <p className="text-xs text-muted">still unspent</p>
          </div>
        )}
      </div>

      {me.income != null && me.income > 0 && (
        <div className="mt-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
            <div style={{ width: `${Math.min(100, ((me.essential ?? 0) / me.income) * 100)}%`, background: "#16a34a" }} title={`essential ${money(me.essential)}`} />
            <div style={{ width: `${Math.min(100, ((me.nonEssential ?? 0) / me.income) * 100)}%`, background: "#dc2626" }} title={`non-essential ${money(me.nonEssential)}`} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {money(me.income)} income · {money(me.total)} spent · <b>{money(left)}</b> left
          </p>
        </div>
      )}

      {me.topCategory && (
        <p className="mt-2 text-sm text-muted">
          Your biggest non-essential is <b>{me.topCategory}</b>
          {me.topCategoryAmount != null && <> at {money(me.topCategoryAmount)}</>}.
        </p>
      )}

      <div className="mt-3 border-t pt-3">
        <label className="text-xs font-medium uppercase tracking-wider text-faint">Income for this challenge</label>
        <p className="mb-2 text-xs text-muted">
          Defaults to your last income entry before the challenge started — most people are paid monthly, so what
          landed during these 30 days is usually the wrong number. Change it to whatever you&apos;re actually living on.
          <br />
          <b>This only moves the percentages.</b> Budget Baddies ranks on dollars spent, so the standings, the race
          chart and the daily chart stay exactly where they were — income changes &ldquo;% of income&rdquo; and the
          percentage view of the board, nothing else.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-surface px-2">
            <span className="text-muted">$</span>
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
