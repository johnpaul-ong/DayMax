"use client";

/** Challenges: time-boxed, joinable, and they leave a record behind. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { localToday } from "@/lib/dates";
import {
  CHALLENGE_METRICS,
  createChallenge,
  defaultDirection,
  dismissInvite,
  fetchChallenges,
  fetchMyInvites,
  joinChallenge,
  metricLabel,
  metricUnit,
  pursuitForMetric,
  type Challenge,
  type ChallengeDirection,
  type ChallengeMetric,
  type PendingInvite,
} from "@/lib/money";
import { fetchDirectory, fetchStats, type Pursuit, type PursuitStat } from "@/lib/pursuits";

export default function ChallengesPage() {
  const [list, setList] = useState<Challenge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  function reload() {
    fetchMyInvites().then(setInvites).catch(() => {});
    fetchChallenges()
      .then(setList)
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist")
            ? "Challenges need migrations 0034–0035 — run them in the Supabase SQL editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  const today = localToday();
  const live = list.filter((c) => c.startsOn <= today && c.endsOn >= today);
  const upcoming = list.filter((c) => c.startsOn > today);
  const done = list.filter((c) => c.endsOn < today);

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <h1 className="mb-1 text-xl font-bold">Challenges</h1>
      <p className="mb-4 text-sm text-muted">
        A pursuit runs forever; a challenge has an end and a winner. When it finishes the result is frozen and stays
        here for good.
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}
      {loading && <p className="text-sm text-muted">Loading…</p>}

      {invites.length > 0 && (
        <section className="mb-6">
          {invites.map((i) => (
            <div key={i.challengeId} className="card mb-2 border-2 border-accent-soft p-4">
              <p className="text-sm">
                <b>{i.invitedByName}</b> invited you to <b>{i.name}</b>
                <span className="text-faint"> · {i.startsOn} → {i.endsOn}</span>
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void joinChallenge(i.challengeId).then(reload)}
                  className="btn-primary py-1.5"
                >
                  Accept
                </button>
                <button onClick={() => void dismissInvite(i.challengeId).then(reload)} className="btn-ghost py-1.5 text-xs">
                  No thanks
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <Section title="Running now" list={live} />
      <Section title="Starting soon" list={upcoming} />
      <Section title="Finished" list={done} muted />

      <div className="mt-6">
        <button onClick={() => setCreating(!creating)} className="text-sm font-medium text-muted hover:text-accent">
          {creating ? "▾" : "▸"} Start your own
        </button>
        {creating && <NewChallenge onCreated={reload} />}
      </div>
    </div>
  );
}

function Section({ title, list, muted }: { title: string; list: Challenge[]; muted?: boolean }) {
  if (list.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      <div className="space-y-3">
        {list.map((c) => (
          <Link
            key={c.id}
            href={`/challenges/${c.id}`}
            className={`card block p-4 transition hover:-translate-y-0.5 ${muted ? "opacity-70" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{c.name}</h3>
              {c.isMember && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">joined</span>}
              <span className="ml-auto text-xs text-faint">
                {c.members} {c.members === 1 ? "person" : "people"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{c.description}</p>
            {/* What actually decides it. Used to be invisible: every challenge
                looked the same on this list whatever it measured. */}
            <p className="mt-2 text-xs font-medium text-accent">{c.metricLabel} wins</p>
            <p className="mt-1 text-xs text-faint">
              {c.startsOn} → {c.endsOn}
              {c.daysLeft > 0 && <> · <b className="text-accent">{c.daysLeft} days left</b></>}
              {c.finalized && " · final"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** ISO date n days after `iso`, in local time. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localToday(d);
}

/** Inclusive length of a window, in days. */
function spanDays(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

const PRESETS = [7, 30, 90];

/**
 * Start your own.
 *
 * This form used to be a name, a one-liner, two dates and a dropdown with two
 * options, both of them money, with the Money pursuit hardcoded into the
 * insert. So you could compete on spending and nothing else, and only ever on
 * "least" — the direction was welded into the metric's name.
 *
 * Now: pick what to measure (money, your day grid, or any stat from a pursuit
 * you're in), pick which end wins, pick how long. Every option here has a
 * branch in challenge_standings() — nothing is offered that the server can't
 * rank, because a dropdown entry that produces an empty leaderboard is worse
 * than no entry.
 */
function NewChallenge({ onCreated }: { onCreated: () => void }) {
  const today = localToday();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [metric, setMetric] = useState<ChallengeMetric>("money_nonessential");
  const [direction, setDirection] = useState<ChallengeDirection>("less");
  const [starts, setStarts] = useState(today);
  const [days, setDays] = useState<number | "custom">(30);
  const [customEnd, setCustomEnd] = useState(addDays(today, 29));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pursuit-stat picker
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [pursuitId, setPursuitId] = useState("");
  const [stats, setStats] = useState<PursuitStat[]>([]);
  const [statId, setStatId] = useState("");

  const needsStat = metric === "pursuit_stat";

  useEffect(() => {
    if (!needsStat || pursuits.length > 0) return;
    // Only pursuits you're a member of: membership is what lets you read the
    // stat's values, and the DB enforces the same rule on insert.
    fetchDirectory()
      .then((ps) => setPursuits(ps.filter((p) => p.isMember && p.kind === "custom")))
      .catch(() => setPursuits([]));
  }, [needsStat, pursuits.length]);

  useEffect(() => {
    if (!pursuitId) {
      setStats([]);
      setStatId("");
      return;
    }
    fetchStats(pursuitId)
      .then((s) => {
        const usable = s.filter((x) => !x.hidden);
        setStats(usable);
        setStatId(usable[0]?.id ?? "");
      })
      .catch(() => setStats([]));
  }, [pursuitId]);

  const stat = stats.find((s) => s.id === statId) ?? null;
  const pursuit = pursuits.find((p) => p.id === pursuitId) ?? null;

  // The metric's natural direction is the starting point; changing metric
  // re-suggests it, and you can always override.
  function pickMetric(m: ChallengeMetric) {
    setMetric(m);
    setDirection(defaultDirection(m, m === "pursuit_stat" ? stat?.direction ?? null : null));
  }
  useEffect(() => {
    if (needsStat && stat) setDirection(stat.direction);
  }, [needsStat, stat]);

  const ends = days === "custom" ? customEnd : addDays(starts, days - 1);
  const length = spanDays(starts, ends);
  const unit = metricUnit(metric, stat?.unit);
  const label = metricLabel(metric, direction, stat?.name);
  const grouped = useMemo(() => {
    const groups: { group: string; items: typeof CHALLENGE_METRICS }[] = [];
    for (const o of CHALLENGE_METRICS) {
      const g = groups.find((x) => x.group === o.group);
      if (g) g.items.push(o);
      else groups.push({ group: o.group, items: [o] });
    }
    return groups;
  }, []);
  const hint = CHALLENGE_METRICS.find((o) => o.metric === metric)?.hint ?? "";

  const blocked =
    !name.trim() ||
    (needsStat && !statId) ||
    length < 1;

  return (
    <div className="card mt-2 space-y-4 p-4">
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name it"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="One line — what are the rules?"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
      </div>

      {/* 1. what are we measuring */}
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-faint">What decides it</label>
        <select
          value={metric}
          onChange={(e) => pickMetric(e.target.value as ChallengeMetric)}
          className="mt-1 w-full rounded-lg border bg-surface px-2 py-2 text-sm"
        >
          {grouped.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((o) => (
                <option key={o.metric} value={o.metric}>
                  {o.noun.charAt(0).toUpperCase() + o.noun.slice(1)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-faint">{hint}</p>
      </div>

      {/* 1b. which stat, if that's the metric */}
      {needsStat && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          {pursuits.length === 0 ? (
            <p className="text-xs text-muted">
              You&apos;re not in any custom pursuit yet.{" "}
              <Link href="/pursuits" className="font-medium text-accent hover:underline">
                Make one →
              </Link>{" "}
              Its stats then show up here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <select
                  value={pursuitId}
                  onChange={(e) => setPursuitId(e.target.value)}
                  className="rounded-lg border bg-surface px-2 py-2 text-sm"
                >
                  <option value="">Which pursuit?</option>
                  {pursuits.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {pursuitId && (
                  <select
                    value={statId}
                    onChange={(e) => setStatId(e.target.value)}
                    className="rounded-lg border bg-surface px-2 py-2 text-sm"
                  >
                    {stats.length === 0 && <option value="">No stats on this pursuit</option>}
                    {stats.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.unit ? ` (${s.unit})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {stat && (
                <p className="text-xs text-faint">
                  {stat.cadence === "daily"
                    ? "Logged daily, so the challenge adds up everything inside the window."
                    : "Logged whenever, so the challenge takes each person's best single value in the window."}
                </p>
              )}
              {pursuit && !pursuit.isPublic && (
                <p className="text-xs text-warn">
                  {pursuit.name} is invite-only. People who join this challenge won&apos;t be added to it
                  automatically, so add them to the pursuit too or they&apos;ll have nowhere to log.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* 2. which end wins — explicit, not baked into the metric's name */}
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-faint">Who wins</label>
        <div className="mt-1 flex gap-2">
          {(["more", "less"] as ChallengeDirection[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                direction === d ? "border-accent bg-accent-soft font-semibold text-accent" : "bg-surface"
              }`}
            >
              {d === "more" ? "Most wins" : "Least wins"}
            </button>
          ))}
        </div>
      </div>

      {/* 3. how long */}
      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-faint">How long</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                days === d ? "border-accent bg-accent-soft font-semibold text-accent" : "bg-surface"
              }`}
            >
              {d} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustomEnd(ends);
              setDays("custom");
            }}
            className={`rounded-lg border px-3 py-2 text-sm ${
              days === "custom" ? "border-accent bg-accent-soft font-semibold text-accent" : "bg-surface"
            }`}
          >
            Custom
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-faint">from</span>
          <input
            type="date"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            className="rounded-lg border bg-surface px-2 py-2 text-sm"
          />
          <span className="text-xs text-faint">to</span>
          {days === "custom" ? (
            <input
              type="date"
              value={customEnd}
              min={starts}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border bg-surface px-2 py-2 text-sm"
            />
          ) : (
            <span className="rounded-lg border bg-surface-2 px-2 py-2 text-sm tabular-nums text-muted">{ends}</span>
          )}
        </div>
      </div>

      {/* the sentence, computed from what's actually set */}
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
        <b>{label}</b> wins
        {unit && unit !== "currency" && <span className="text-muted"> (measured in {unit})</span>}, over{" "}
        {length} {length === 1 ? "day" : "days"}, {starts} → {ends}.
      </p>

      <button
        onClick={() => {
          if (blocked) return;
          setBusy(true);
          setErr(null);
          createChallenge({
            name: name.trim(),
            description: desc.trim(),
            startsOn: starts,
            endsOn: ends,
            metric,
            direction,
            statId: needsStat ? statId : null,
            pursuitId: needsStat ? pursuitId || null : pursuitForMetric(metric),
          })
            .then(() => {
              setName("");
              setDesc("");
              onCreated();
            })
            .catch((e) => setErr(String(e.message ?? e)))
            .finally(() => setBusy(false));
        }}
        disabled={busy || blocked}
        className="btn-primary"
      >
        {busy ? "Creating…" : "Create challenge"}
      </button>
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
