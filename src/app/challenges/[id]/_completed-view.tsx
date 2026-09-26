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
import {
  CartesianGrid,
  Cell,
  Bar,
  BarChart,
  Label,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatScore, metricFamily, type Challenge, type ChallengeDay, type Standing } from "@/lib/money";
import {
  fetchLifeSummary,
  fetchRecaps,
  fetchResults,
  finalizeChallenge,
  type ChallengeResult,
  type LifeSummary,
  type Recap,
} from "@/lib/challengeRecaps";
import { dayPatterns, MIN_DAYS, type Pattern } from "@/lib/dayPatterns";
import { fetchMemberDayStrip } from "@/lib/profiles";
import { TeamDot } from "../../team-name";
import CategoryLegend from "../../category-legend";
import { AverageDayClock, MembersHoursBars } from "./_life-views";
import ChallengeFeed from "./feed";

// Fixed categorical order — colours follow the ENTITY, not its rank. Everyone's
// bar, line and endpoint dot uses the same colour across every chart on this
// page, so identity survives when the eye moves between them. First 8 hues
// snapped from the app's shared SERIES; a 9th person folds into "Other" (see
// the leaderboard fallback) rather than cycling.
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
  const [patterns, setPatterns] = useState<Map<string, Pattern[]>>(new Map());
  const memberKey = rows.filter((r) => r.entries >= MIN_DAYS).map((r) => r.userId).join(",");
  const family = metricFamily(challenge.metric);
  const isLife = family === "life";

  // Each member's day shape, as far as they share it with this viewer:
  // member_day_strip returns nothing (or refuses) for anyone who keeps their
  // day private, and they simply get no patterns box.
  useEffect(() => {
    if (!memberKey) return;
    let alive = true;
    Promise.all(
      memberKey.split(",").map((uid) =>
        fetchMemberDayStrip(uid, challenge.startsOn, challenge.endsOn)
          .then((strip) => [uid, dayPatterns(strip)] as const)
          .catch(() => [uid, [] as Pattern[]] as const),
      ),
    ).then((pairs) => { if (alive) setPatterns(new Map(pairs)); });
    return () => { alive = false; };
  }, [memberKey, challenge.startsOn, challenge.endsOn]);

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

  // Colour per user, assigned once in rank order, then shared by every chart
  // on the page. Never cycled: person 9+ folds into the muted token.
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    people.forEach((p, i) => { m.set(p.userId, i < SERIES.length ? SERIES[i] : "var(--muted)"); });
    return m;
  }, [people]);

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

  // Cumulative-per-person series over the challenge window: date -> {name -> running}.
  // Same shape as before, but with the *display name* keyed per person; the
  // chart uses userId under the hood via `people` for stable colours.
  const raceData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const d of daily) {
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![d.userId] = d.running;
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [daily]);
  const raceMagnitude = daily.reduce((s, d) => Math.max(s, Math.abs(d.running)), 0);
  // Endpoints: each person's final running value, at the last date they have
  // data on. Rendered as dots plus a direct name label so the chart doesn't
  // need a legend box (identity is at the line's tip).
  const endpoints = useMemo(() => {
    const last = new Map<string, { date: string; value: number }>();
    for (const d of daily) {
      const prev = last.get(d.userId);
      if (!prev || d.date > prev.date) last.set(d.userId, { date: d.date, value: d.running });
    }
    return people
      .filter((p) => last.has(p.userId))
      .map((p) => ({
        userId: p.userId,
        name: p.displayName,
        color: colorOf.get(p.userId) ?? "var(--muted)",
        ...last.get(p.userId)!,
      }));
  }, [daily, people, colorOf]);

  // Leaderboard bars use the entity colour, but the winner keeps the crown
  // colouring visible via a slightly wider stroke rather than a rank-driven
  // gold — otherwise a filter to two people would recolour the survivors,
  // which the dataviz rules explicitly forbid ("colour follows the entity").
  const leaderboardData = useMemo(
    () =>
      people.map((p) => ({
        userId: p.userId,
        name: p.displayName,
        score: p.score ?? 0,
        color: colorOf.get(p.userId) ?? "var(--muted)",
        rank: p.rank,
      })),
    [people, colorOf],
  );

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

      {/* Final leaderboard as a horizontal bar chart. Sorted by rank (winner
          on top), one row per person, bar coloured by that person's entity
          hue so the row lines up with their line in the cumulative chart and
          their dot in the per-person cards. Numeric score labelled at the
          end of each bar so no value is colour-alone. */}
      {isParticipant && leaderboardData.length > 1 && (
        <section>
          <h2 className="mb-2 font-semibold">
            Final leaderboard
            <span className="ml-2 text-xs font-normal text-muted">{metricLabel}.</span>
          </h2>
          <div className="card p-2" style={{ height: Math.max(140, leaderboardData.length * 34 + 40) }}>
            <ResponsiveContainer>
              <BarChart
                data={leaderboardData}
                layout="vertical"
                margin={{ top: 8, right: 56, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--ink)" }}
                  width={100}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: number) => fmt(Number(v))}
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {leaderboardData.map((p) => (
                    <Cell key={p.userId} fill={p.color} />
                  ))}
                  <LabelList
                    dataKey="score"
                    position="right"
                    formatter={(v: number) => fmt(Number(v))}
                    style={{ fontSize: 11, fill: "var(--ink)", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Redesigned "how the race went" — a proper cumulative-over-time
          chart. Y axis labelled with the metric unit; each line ends in a
          coloured dot with the person's name at the tip so no legend box is
          needed for <=4 members; a legend row is drawn below the plot for
          bigger groups. Colours follow the entity (colorOf), matching the
          leaderboard bars and the per-person card accents. */}
      {isParticipant && raceData.length >= 2 && raceMagnitude > 0 && endpoints.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">
            Cumulative {noun}
            <span className="ml-2 text-xs font-normal text-muted">Over the {totalDays}-day window.</span>
          </h2>
          <div className="h-60 card p-2">
            <ResponsiveContainer>
              <LineChart data={raceData} margin={{ top: 12, right: 80, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickFormatter={tick}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }}>
                  <Label
                    value={unit === "h" ? "hours" : unit || noun}
                    angle={-90}
                    position="insideLeft"
                    style={{ fontSize: 10, fill: "var(--muted)" }}
                  />
                </YAxis>
                <Tooltip
                  formatter={(v: number, name) => {
                    const p = people.find((x) => x.userId === name);
                    return [fmt(Number(v)), p?.displayName ?? String(name)];
                  }}
                  labelFormatter={(d) => String(d)}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }}
                />
                {people.map((p) => (
                  <Line
                    key={p.userId}
                    type="monotone"
                    dataKey={p.userId}
                    name={p.userId}
                    stroke={colorOf.get(p.userId) ?? "var(--muted)"}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                {endpoints.map((e) => (
                  <ReferenceDot
                    key={e.userId}
                    x={e.date}
                    y={e.value}
                    r={4}
                    fill={e.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    // Direct label at the endpoint replaces a legend for
                    // <=4 members; larger groups get the fallback below.
                    label={endpoints.length <= 4
                      ? { value: e.name.split(/\s+/)[0], position: "right", fontSize: 10, fill: e.color, offset: 6 }
                      : undefined}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {endpoints.length > 4 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              {endpoints.map((e) => (
                <span key={e.userId} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-4 rounded-sm" style={{ background: e.color }} />
                  {e.name}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Life-only restorations. The group's typical day answers "when were
          the goblins actually productive?", and the per-person bucket bars
          answer "who spent their hours on what?" — both were on the live
          board and are equally informative frozen. Skipped on money / stat
          challenges, where the day-clock is meaningless. */}
      {isParticipant && isLife && people.length > 0 && (
        <>
          <CategoryLegend />
          <AverageDayClock
            members={people.map((p) => ({ id: p.userId, name: p.displayName }))}
            from={challenge.startsOn}
            to={challenge.endsOn}
            title="The group's typical day"
            subtitle="Modal category per 15-minute slot across everyone who logged."
          />
          <section>
            <h2 className="mb-2 font-semibold">
              Hours per person
              <span className="ml-2 text-xs font-normal text-muted">Averaged over each member&apos;s logged days.</span>
            </h2>
            <MembersHoursBars
              members={people.map((p) => ({ id: p.userId, name: p.displayName }))}
              from={challenge.startsOn}
              to={challenge.endsOn}
              maxWidth={720}
            />
          </section>
        </>
      )}

      {isParticipant && people.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Everyone</h2>
          <div className="space-y-3">
            {people.map((p) => (
              <article
                key={p.userId}
                className={`card p-4 ${p.isMe ? "border-accent" : ""}`}
                style={{ borderLeft: `4px solid ${colorOf.get(p.userId) ?? "var(--border)"}` }}
              >
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
                {(patterns.get(p.userId) ?? []).length > 0 && (
                  <div className="mt-3 rounded-lg bg-surface-2 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                      {p.isMe ? "Your patterns" : `${p.displayName}'s patterns`}
                    </div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                      {patterns.get(p.userId)!.map((x) => <li key={x.kind}>{x.text}</li>)}
                    </ul>
                  </div>
                )}
                {p.isMe && p.entries < MIN_DAYS && (
                  <p className="mt-3 text-xs text-faint">
                    Log at least {MIN_DAYS} full days in a challenge to get your time-of-day patterns here.
                  </p>
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
