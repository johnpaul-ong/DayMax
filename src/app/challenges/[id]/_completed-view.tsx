"use client";

/**
 * What a challenge page becomes once it is over: a record, not a board.
 *
 * SOFT freeze. Nothing here writes except finalize_challenge(), which is
 * idempotent; every join / log / invite / leave / post control is gone, but
 * RLS is unchanged, so data can still be corrected behind the scenes.
 *
 * Ranks come from challenge_results (frozen at finalize) when they exist, so a
 * late backfill can't reshuffle a finished podium. Until the database agrees
 * the challenge is over (it runs on UTC) the live standings stand in.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatScore, type Challenge, type ChallengeDay, type Standing } from "@/lib/money";
import {
  fetchLifeSummary,
  fetchRecaps,
  fetchResults,
  finalizeChallenge,
  type ChallengeResult,
  type LifeSummary,
  type Recap,
} from "@/lib/challengeRecaps";
import { TeamDot } from "../../team-name";
import ChallengeFeed from "./feed";

const SERIES = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tick = (d: string) => (typeof d === "string" ? d.slice(5) : d);
const hours = (v: number) => formatScore(v, "h");

export default function CompletedView({
  challenge,
  rows,
  daily,
  currency,
  metricLabel,
  noun,
  roster,
}: {
  challenge: Challenge;
  rows: Standing[];
  daily: ChallengeDay[];
  currency?: string;
  metricLabel: string;
  noun: string;
  roster: string;
}) {
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [life, setLife] = useState<LifeSummary[]>([]);
  const [recaps, setRecaps] = useState<Recap[]>([]);

  useEffect(() => {
    let alive = true;
    // Members only — the standings functions refuse anyone else.
    if (!challenge.isMember && !challenge.isOwner) return;
    finalizeChallenge(challenge.id)
      .then(() => fetchResults(challenge.id))
      .then((r) => { if (alive) setResults(r); })
      .catch(() => {});
    fetchLifeSummary(challenge.id).then((l) => { if (alive) setLife(l); }).catch(() => {});
    fetchRecaps(challenge.id)
      // The admin's RLS also returns drafts; this page only ever shows approved.
      .then((r) => { if (alive) setRecaps(r.filter((x) => x.status === "visible")); })
      .catch(() => {});
    return () => { alive = false; };
  }, [challenge.id, challenge.isMember, challenge.isOwner]);

  const unit = rows[0]?.scoreUnit ?? challenge.scoreUnit ?? "";
  const fmt = (v: number | null | undefined) => formatScore(v, unit, currency);
  const totalDays = Math.round((Date.parse(challenge.endsOn) - Date.parse(challenge.startsOn)) / 86_400_000) + 1;

  const people = useMemo(() => {
    const frozen = new Map(results.map((r) => [r.userId, r]));
    const lifeBy = new Map(life.map((l) => [l.userId, l]));
    const recapBy = new Map(recaps.map((r) => [r.userId, r]));
    const list = rows.map((r, i) => {
      const f = frozen.get(r.userId);
      return {
        ...r,
        rank: f?.rank ?? i + 1,
        score: f ? f.score : r.score,
        life: lifeBy.get(r.userId) ?? null,
        recap: recapBy.get(r.userId) ?? null,
      };
    });
    return list.sort((a, b) => a.rank - b.rank);
  }, [rows, results, life, recaps]);

  const scored = people.filter((p) => p.score != null);
  const winner = scored[0];
  const daysLogged = people.reduce((s, p) => s + p.entries, 0);
  const avgScore = scored.length > 0 ? scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length : null;
  const groupLife = useMemo(() => {
    if (life.length === 0) return null;
    const ph = life.reduce((s, l) => s + l.productiveHours, 0);
    const bh = life.reduce((s, l) => s + l.brainrotHours, 0);
    const sh = life.reduce((s, l) => s + l.sleepHours, 0);
    const dl = life.reduce((s, l) => s + l.daysLogged, 0);
    return {
      productive: ph,
      focus: ph + bh > 0 ? Math.round((ph / (ph + bh)) * 1000) / 10 : null,
      sleepPerNight: dl > 0 ? sh / dl : null,
    };
  }, [life]);

  const raceData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const d of daily) {
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![d.displayName] = d.running;
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [daily]);
  const names = useMemo(() => [...new Set(daily.map((d) => d.displayName))], [daily]);
  const raceMagnitude = daily.reduce((s, d) => Math.max(s, Math.abs(d.running)), 0);

  const isParticipant = challenge.isMember || challenge.isOwner;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{challenge.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">FINISHED</span>
        </div>
        <p className="mt-1 text-sm text-muted">{challenge.description}</p>
        <p className="mt-2 text-xs font-medium text-accent">{metricLabel} won</p>
        <p className="mt-1 text-xs text-faint">{challenge.startsOn} → {challenge.endsOn} · {totalDays} days</p>
      </div>

      {!isParticipant && (
        <p className="card p-4 text-sm text-muted">This challenge is over. Only the people who took part can see how it went.</p>
      )}

      {isParticipant && winner && (
        <div className="card p-4">
          <p className="text-sm">
            <b>{winner.displayName}</b> won with {fmt(winner.score)} of {noun}.{" "}
            The {people.length} {roster.toLowerCase()} logged {daysLogged} of {people.length * totalDays} possible days
            {groupLife ? <> and {hours(groupLife.productive)} of productive time between them</> : null}.
          </p>
        </div>
      )}

      {isParticipant && people.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">The group</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={roster} value={String(people.length)} />
            <Tile label="Days logged" value={`${daysLogged}/${people.length * totalDays}`} />
            <Tile label={`Average ${noun}`} value={fmt(avgScore)} />
            {groupLife ? (
              <Tile label="Group focus" value={formatScore(groupLife.focus, "%")} />
            ) : (
              <Tile label={`Best ${noun}`} value={fmt(winner?.score)} />
            )}
            {groupLife && <Tile label="Productive hours" value={hours(groupLife.productive)} />}
            {groupLife && groupLife.sleepPerNight != null && <Tile label="Sleep per logged day" value={hours(groupLife.sleepPerNight)} />}
          </div>
        </section>
      )}

      {isParticipant && raceData.length >= 2 && raceMagnitude > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">
            How the race went
            <span className="ml-2 text-xs font-normal text-muted">Running {noun}, day by day.</span>
          </h2>
          <div className="h-48 card p-2">
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
        </section>
      )}

      {isParticipant && people.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Everyone</h2>
          <div className="space-y-3">
            {people.map((p) => (
              <article key={p.userId} className={`card p-4 ${p.isMe ? "border-accent" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="w-7 text-center text-lg font-bold text-faint">
                    {p.score == null ? "–" : p.rank === 1 ? "👑" : p.rank}
                  </span>
                  <Link href={p.isMe ? "/profile" : `/friends/${p.userId}`} className="inline-flex items-center gap-1.5 font-semibold hover:text-accent hover:underline">
                    {p.displayName}
                    <TeamDot team={p.team} />
                  </Link>
                  {p.isMe && <span className="text-xs text-accent">you</span>}
                  <span className="ml-auto text-lg font-bold tabular-nums">{fmt(p.score)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-9 text-xs text-faint">
                  <span>{p.entries} of {totalDays} days logged</span>
                  {p.perDay > 0 && <span>{fmt(p.perDay)}/day</span>}
                  {p.life && <span>{hours(p.life.productiveHours)} productive</span>}
                  {p.life && <span>{hours(p.life.brainrotHours)} brainrot</span>}
                  {p.life?.focus != null && <span>{p.life.focus}% focus</span>}
                </div>
                {p.recap && (
                  <p className="mt-3 whitespace-pre-line border-l-2 border-accent pl-3 text-sm">{p.recap.body}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {isParticipant && (
        <ChallengeFeed
          challengeId={challenge.id}
          startsOn={challenge.startsOn}
          endsOn={challenge.endsOn}
          me={rows.find((r) => r.isMe)?.userId ?? null}
          isMember={challenge.isMember}
          readOnly
        />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
