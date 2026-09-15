"use client";

/**
 * One challenge: live standings while it runs, a frozen result after.
 *
 * The privacy shape is the important bit. Percentages are shared by joining;
 * dollar amounts are opt-in and off by default. The table shows "—" rather than
 * a number for anyone who hasn't opted in, and says so, so nobody thinks the
 * app is broken.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { localToday } from "@/lib/dates";
import {
  fetchChallenges,
  fetchStandings,
  joinChallenge,
  leaveChallenge,
  money,
  setShareAmounts,
  type Challenge,
  type Standing,
} from "@/lib/money";
import { teamMeta } from "@/lib/teams";
import { TeamDot } from "../../team-name";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [rows, setRows] = useState<Standing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const today = localToday();

  function reload() {
    fetchChallenges()
      .then((cs) => setChallenge(cs.find((c) => c.id === id) ?? null))
      .catch((e) => setError(String(e.message ?? e)));
    fetchStandings(id)
      .then(setRows)
      .catch(() => setRows([])); // not a member yet: standings are hidden, not broken
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

  if (error) return <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>;
  if (!challenge) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
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
            <span>
              {running ? `${challenge.daysLeft} days left` : finished ? "over" : "not started"}
            </span>
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
              <button
                onClick={() => void leaveChallenge(id).then(reload)}
                className="btn-ghost text-xs"
              >
                Leave
              </button>
            </>
          )}
          <button
            onClick={() => {
              const url = `${location.origin}/challenges/${id}`;
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
              if (navigator.share) navigator.share({ title: challenge.name, url }).catch(() => {});
            }}
            className="btn-ghost"
          >
            {copied ? "Link copied ✓" : "Invite someone"}
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">
          Anyone with the link can join — they don&apos;t need to be in the Money pursuit first; joining puts them there.
        </p>
      </div>

      {!challenge.isMember && (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">What joining shares</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Your <b>non-essential spending as a percentage of your income</b> becomes visible to other members. That&apos;s how you&apos;re ranked.</li>
            <li>Dollar amounts stay <b>private unless you switch them on</b>.</li>
            <li>Nobody outside the challenge sees anything.</li>
            <li>Individual purchases are never shared — only the totals.</li>
          </ul>
        </div>
      )}

      {challenge.isMember && me && (
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">You</h2>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-3xl font-bold tabular-nums">{me.pct ?? "—"}%</p>
              <p className="text-xs text-muted">of income, non-essential</p>
            </div>
            <div>
              <p className="text-3xl font-bold tabular-nums">{money(me.nonEssential)}</p>
              <p className="text-xs text-muted">non-essential</p>
            </div>
            <div>
              <p className="text-3xl font-bold tabular-nums">{money(me.essential)}</p>
              <p className="text-xs text-muted">essential</p>
            </div>
          </div>
          {me.pct === null && (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              Add your income on the <Link href="/money" className="font-medium underline">Money page</Link> — without it
              you can&apos;t be ranked on percentage.
            </p>
          )}
          <label className="mt-3 flex items-start gap-2 border-t pt-3 text-sm">
            <input
              type="checkbox"
              checked={me.sharesAmounts}
              onChange={(e) => void setShareAmounts(id, e.target.checked).then(reload)}
              className="mt-0.5"
            />
            <span>
              <b>Show my dollar amounts</b> to other members. Off by default — your percentage is shared either way.
            </span>
          </label>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <section>
            <h2 className="mb-1 font-semibold">{finished ? "Final standings" : "Live standings"}</h2>
            <p className="mb-2 text-sm text-muted">
              Lowest share of income wins. Updates as people log.
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2 text-right">% of income</th>
                    <th className="px-3 py-2 text-right">Non-essential</th>
                    <th className="px-3 py-2 text-right">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.userId} className={`border-b last:border-0 ${r.isMe ? "bg-accent-soft/40" : ""}`}>
                      <td className="px-3 py-2 font-bold text-faint">
                        {i === 0 && !finished ? "👑" : i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/friends/${r.userId}`} className="inline-flex items-center gap-1.5 font-medium hover:text-accent hover:underline">
                          {r.displayName}
                          <TeamDot team={r.team} />
                        </Link>
                        {r.isMe && <span className="ml-1 text-xs text-accent">you</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {r.pct == null ? <span className="text-faint">no income set</span> : `${r.pct}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.nonEssential == null ? <span className="text-faint" title="This person keeps their amounts private">private</span> : money(r.nonEssential)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-faint">{r.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Side by side</h2>
            <div className="h-64 card p-2">
              <ResponsiveContainer>
                <BarChart data={rows.filter((r) => r.pct != null).map((r) => ({ name: r.displayName, pct: r.pct }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(v: number) => [`${v}% of income`, "non-essential"]} />
                  <Bar dataKey="pct" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {challenge.isMember && rows.length <= 1 && (
        <p className="card p-4 text-sm text-faint">
          Nobody else has joined yet. Use <b>Invite someone</b> above — the link works for anyone, whether or not
          they use the Money pursuit.
        </p>
      )}
    </div>
  );
}
