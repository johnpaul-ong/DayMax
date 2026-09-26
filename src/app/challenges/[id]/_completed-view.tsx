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

/** Every panel in the results carousel is the same square footprint so the
 *  strip reads as a set, not a jumble. Small on phones, a touch larger from
 *  sm up so charts breathe on a laptop. */
const PANEL = 340;

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

  const scored = people.filter((p) => p.score != null && p.score > 0);
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

  // Cumulative-per-person series over the challenge window: date -> {userId -> running}.
  // Keys are userIds so the line chart maps stable identity to colour; the
  // tooltip resolves back to the display name via `people`.
  const raceData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number>>();
    for (const d of daily) {
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![d.userId] = d.running;
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [daily]);
  const raceMagnitude = daily.reduce((s, d) => Math.max(s, Math.abs(d.running)), 0);
  // Endpoints: each person's final running value, at the last date in the
  // window. Members with zero contribution still get an endpoint (at y=0),
  // so nobody vanishes from the picture just because they didn't log.
  const endpoints = useMemo(() => {
    const last = new Map<string, { date: string; value: number }>();
    for (const d of daily) {
      const prev = last.get(d.userId);
      if (!prev || d.date > prev.date) last.set(d.userId, { date: d.date, value: d.running });
    }
    // Anyone not in daily at all (e.g. joined but daily returned nothing)
    // gets a zero endpoint at the last date so their row still appears.
    const lastDate = raceData[raceData.length - 1]?.date as string | undefined;
    return people.map((p) => {
      const e = last.get(p.userId);
      return {
        userId: p.userId,
        name: p.displayName,
        color: colorOf.get(p.userId) ?? "var(--muted)",
        date: e?.date ?? lastDate ?? challenge.endsOn,
        value: e?.value ?? 0,
        hasData: (e?.value ?? 0) > 0,
      };
    });
  }, [daily, people, colorOf, raceData, challenge.endsOn]);

  // Per-day contribution matrix for the small-multiples panel: userId ->
  // date -> value (0 for no logs). Every person × every date is present so
  // Grilled Ham's row is still a full-width strip of zeros, not a blank card.
  const perDayByUser = useMemo(() => {
    const dates = [...new Set(daily.map((d) => d.date))].sort();
    const dailyMax = daily.reduce((s, d) => Math.max(s, d.spent), 0);
    const byUser = new Map<string, { date: string; value: number }[]>();
    for (const p of people) {
      byUser.set(p.userId, dates.map((date) => {
        const hit = daily.find((d) => d.userId === p.userId && d.date === date);
        return { date, value: hit?.spent ?? 0 };
      }));
    }
    return { dates, dailyMax, byUser };
  }, [daily, people]);

  // Leaderboard bars use the entity colour. Score is coerced to 0 for
  // no-data members so the row still renders; the label at the end shows
  // "no logs" instead of a number, and a 4-px tick on the axis makes the
  // presence of the row visible even when the bar is invisibly short.
  const leaderboardData = useMemo(
    () =>
      people.map((p) => ({
        userId: p.userId,
        name: p.displayName,
        score: p.score ?? 0,
        color: colorOf.get(p.userId) ?? "var(--muted)",
        rank: p.rank,
        hasData: (p.score ?? 0) > 0,
      })),
    [people, colorOf],
  );

  const isParticipant = challenge.isMember || challenge.isOwner;

  // Which panels the carousel shows for this challenge type. Life gets the
  // full set; money / stat challenges skip the day-clock, hours-per-person
  // and per-day panels because the underlying data isn't a day grid.
  const panels: { key: string; node: React.ReactNode }[] = [];
  if (isParticipant && leaderboardData.length > 0) {
    panels.push({
      key: "leaderboard",
      node: (
        <PanelCard title="Final leaderboard" subtitle={metricLabel}>
          <FinalLeaderboardChart data={leaderboardData} fmt={fmt} />
        </PanelCard>
      ),
    });
  }
  if (isParticipant && raceData.length >= 2 && raceMagnitude > 0) {
    panels.push({
      key: "cumulative",
      node: (
        <PanelCard title={`Cumulative ${noun}`} subtitle={`Over the ${totalDays}-day window.`}>
          <CumulativeChart
            raceData={raceData}
            people={people}
            colorOf={colorOf}
            endpoints={endpoints}
            unit={unit}
            noun={noun}
            fmt={fmt}
          />
        </PanelCard>
      ),
    });
  }
  if (isParticipant && isLife && people.length > 0) {
    panels.push({
      key: "clock",
      node: (
        <PanelCard title="Group's typical day" subtitle="Modal category per 15-minute slot.">
          <div className="flex items-center justify-center">
            <AverageDayClock
              members={people.map((p) => ({ id: p.userId, name: p.displayName }))}
              from={challenge.startsOn}
              to={challenge.endsOn}
              title=""
            />
          </div>
        </PanelCard>
      ),
    });
    panels.push({
      key: "hours",
      node: (
        <PanelCard title="Hours per person" subtitle="Averaged per logged day.">
          <MembersHoursBars
            members={people.map((p) => ({ id: p.userId, name: p.displayName }))}
            from={challenge.startsOn}
            to={challenge.endsOn}
            maxWidth={PANEL - 12}
          />
        </PanelCard>
      ),
    });
    panels.push({
      key: "perday",
      node: (
        <PanelCard title="Day by day, per person" subtitle={`${noun} on each of ${totalDays} days.`}>
          <PerPersonDailyBars
            people={people}
            perDay={perDayByUser}
            colorOf={colorOf}
            unit={unit}
            fmt={fmt}
          />
        </PanelCard>
      ),
    });
  }

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

      {/* One horizontally-scrollable strip of square panels. Same shape as
          the live board's life-challenge graphs strip so the interaction
          is the one people already know: wheel / trackpad / touch drag,
          snap on each card. */}
      {panels.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Graphs</h2>
          <div
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "thin" }}
          >
            {panels.map((p) => (
              <div key={p.key} className="shrink-0 snap-start">
                {p.node}
              </div>
            ))}
          </div>
        </section>
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

      {/* For life challenges, the category legend once at the bottom of
          the group section so the day-clock and hours-per-person panels
          have a colour key without a per-chart legend. */}
      {isParticipant && isLife && <CategoryLegend />}

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

/**
 * A square card at the standard PANEL size. Title + optional subtitle at
 * the top; the remainder of the square is the chart area. Kept as a
 * component so every panel in the carousel has the same footprint and the
 * strip reads as a set.
 */
function PanelCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col p-3" style={{ width: PANEL, height: PANEL }}>
      <div className="mb-2 shrink-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function FinalLeaderboardChart({
  data,
  fmt,
}: {
  data: { userId: string; name: string; score: number; color: string; rank: number; hasData: boolean }[];
  fmt: (v: number | null | undefined) => string;
}) {
  return (
    <ResponsiveContainer>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted)" }} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--ink)" }}
          width={92}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(v: number, _n, entry: any) =>
            entry?.payload?.hasData ? fmt(Number(v)) : "no logs"
          }
          cursor={{ fill: "var(--surface-2)" }}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((p) => (
            <Cell key={p.userId} fill={p.color} />
          ))}
          <LabelList
            dataKey="score"
            position="right"
            formatter={(v: number) => (v > 0 ? fmt(Number(v)) : "no logs")}
            style={{ fontSize: 11, fill: "var(--ink)", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CumulativeChart({
  raceData,
  people,
  colorOf,
  endpoints,
  unit,
  noun,
  fmt,
}: {
  raceData: Record<string, string | number>[];
  people: { userId: string; displayName: string }[];
  colorOf: Map<string, string>;
  endpoints: { userId: string; name: string; color: string; date: string; value: number; hasData: boolean }[];
  unit: string;
  noun: string;
  fmt: (v: number | null | undefined) => string;
}) {
  const directLabels = endpoints.length <= 4;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer>
          <LineChart data={raceData} margin={{ top: 8, right: directLabels ? 56 : 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "var(--muted)" }}
              tickFormatter={tick}
              minTickGap={16}
            />
            <YAxis tick={{ fontSize: 9, fill: "var(--muted)" }} width={30}>
              <Label
                value={unit === "h" ? "h" : unit || noun}
                angle={-90}
                position="insideLeft"
                style={{ fontSize: 9, fill: "var(--muted)" }}
                offset={10}
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
                label={directLabels
                  ? { value: e.name.split(/\s+/)[0], position: "right", fontSize: 10, fill: e.color, offset: 6 }
                  : undefined}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {!directLabels && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted">
          {endpoints.map((e) => (
            <span key={e.userId} className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-3 rounded-sm" style={{ background: e.color }} />
              <span className={e.hasData ? "" : "italic text-faint"}>
                {e.name}{e.hasData ? "" : " (0)"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Small-multiples: one mini vertical-bar chart per person, arranged in a
 * grid inside the square panel. Every mini shares the same y-scale
 * (dailyMax) so a tall bar in one panel is directly comparable to a tall
 * bar in another. A member with no logs still appears — their card shows
 * their name and a flat baseline row of empty bars, so nobody is dropped
 * from the picture just because they didn't play.
 */
function PerPersonDailyBars({
  people,
  perDay,
  colorOf,
  unit,
  fmt,
}: {
  people: { userId: string; displayName: string }[];
  perDay: { dates: string[]; dailyMax: number; byUser: Map<string, { date: string; value: number }[]> };
  colorOf: Map<string, string>;
  unit: string;
  fmt: (v: number | null | undefined) => string;
}) {
  const { dates, dailyMax } = perDay;
  // Grid columns based on member count: 2 columns is the phone-friendly
  // default; if there are 3–4 people we still use 2 wide (so each mini is
  // roughly square inside a 320-px square panel), 5–6 goes to 3 columns.
  const cols = people.length <= 4 ? 2 : 3;
  const gapPx = 6;
  return (
    <div
      className="grid h-full"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: gapPx,
      }}
    >
      {people.map((p) => {
        const series = perDay.byUser.get(p.userId) ?? [];
        const color = colorOf.get(p.userId) ?? "var(--muted)";
        const has = series.some((s) => s.value > 0);
        return (
          <div key={p.userId} className="flex min-h-0 flex-col rounded-lg bg-surface-2 p-1.5">
            <div className="mb-1 flex items-baseline justify-between gap-1 text-[10px]">
              <span className="truncate font-medium text-ink" title={p.displayName}>
                {p.displayName.split(/\s+/)[0]}
              </span>
              <span className="shrink-0 tabular-nums text-faint">
                {has ? fmt(series.reduce((s, x) => s + x.value, 0)) : "—"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <MiniDailyBars
                series={series}
                max={dailyMax}
                color={color}
                unit={unit}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pure-SVG vertical bar chart: one bar per day, bars share the space
 * equally with a 2-px gutter, height scales to a shared `max`. Kept off
 * Recharts because a grid of six little Recharts instances is heavier
 * than the whole page, and there's no interaction we need here beyond
 * the aggregate tooltip.
 */
function MiniDailyBars({
  series,
  max,
  color,
  unit,
}: {
  series: { date: string; value: number }[];
  max: number;
  color: string;
  unit: string;
}) {
  const n = series.length;
  if (n === 0 || max <= 0) {
    return (
      <div className="flex h-full items-end justify-center text-[10px] text-faint">
        no logs
      </div>
    );
  }
  return (
    <svg viewBox={`0 0 ${n * 10} 40`} preserveAspectRatio="none" className="h-full w-full">
      {/* Baseline so an all-zero row still reads as a chart. */}
      <line x1={0} y1={40} x2={n * 10} y2={40} stroke="var(--border)" strokeWidth={0.5} />
      {series.map((s, i) => {
        const h = max > 0 ? (s.value / max) * 38 : 0;
        return (
          <rect
            key={s.date}
            x={i * 10 + 1}
            y={40 - h}
            width={8}
            height={h}
            rx={1}
            fill={color}
            fillOpacity={s.value > 0 ? 0.9 : 0}
          >
            <title>
              {s.date}: {s.value > 0 ? `${Math.round(s.value * 10) / 10}${unit ? ` ${unit}` : ""}` : "no logs"}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
