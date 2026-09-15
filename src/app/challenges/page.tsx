"use client";

/** Challenges: time-boxed, joinable, and they leave a record behind. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { localToday } from "@/lib/dates";
import { createChallenge, dismissInvite, fetchChallenges, fetchMyInvites, joinChallenge, type Challenge, type PendingInvite } from "@/lib/money";

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
            <p className="mt-2 text-xs text-faint">
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

function NewChallenge({ onCreated }: { onCreated: () => void }) {
  const today = localToday();
  const in30 = (() => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() + 30);
    return localToday(d);
  })();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState(in30);
  const [metric, setMetric] = useState<Challenge["metric"]>("lower_nonessential");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="card mt-2 p-4">
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it" className="w-full rounded-lg border bg-surface px-3 py-2 text-sm" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One line — what are the rules?" className="w-full rounded-lg border bg-surface px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className="rounded-lg border bg-surface px-2 py-2 text-sm" />
          <select value={metric} onChange={(e) => setMetric(e.target.value as Challenge["metric"])} className="rounded-lg border bg-surface px-2 py-2 text-sm">
            <option value="lower_nonessential">Least non-essential, in dollars</option>
            <option value="lower_nonessential_pct">Least non-essential, as % of income</option>
          </select>
        </div>
        <p className="text-xs text-faint">
          Dollars is what people actually argue about, so it&apos;s the default — the percentage-of-income view is
          shown on the board either way. Pick percent if your group&apos;s incomes are wildly different.
        </p>
        <button
          onClick={() => {
            if (!name.trim()) return;
            setBusy(true);
            createChallenge({
              name: name.trim(),
              description: desc.trim(),
              startsOn: starts,
              endsOn: ends,
              metric,
              pursuitId: "33333333-3333-4333-8333-333333333305",
            })
              .then(() => {
                setName("");
                setDesc("");
                onCreated();
              })
              .catch((e) => setErr(String(e.message ?? e)))
              .finally(() => setBusy(false));
          }}
          disabled={busy || !name.trim()}
          className="btn-primary"
        >
          {busy ? "Creating…" : "Create challenge"}
        </button>
        {err && <p className="text-sm text-danger">{err}</p>}
      </div>
    </div>
  );
}
