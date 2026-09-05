"use client";

/**
 * My pursuits: quick chips to jump between them, a summary card per pursuit
 * with your recent trend, and the create form.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  createPursuit,
  fetchDirectory,
  fetchMyEntries,
  fetchStats,
  pursuitHref,
  type Pursuit,
} from "@/lib/pursuits";

interface Spark {
  statName: string;
  points: Array<{ date: string; value: number }>;
  today: number | null;
  total: number;
}

export default function PursuitsPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [sparks, setSparks] = useState<Record<string, Spark | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  function reload() {
    fetchDirectory()
      .then(async (ds) => {
        setPursuits(ds);
        const mine = ds.filter((d) => d.isMember && d.kind === "custom").slice(0, 8);
        const out: Record<string, Spark | null> = {};
        await Promise.all(
          mine.map(async (m) => {
            try {
              const stats = await fetchStats(m.id);
              const first = stats.find((st) => !st.hidden);
              if (!first) return void (out[m.id] = null);
              const entries = await fetchMyEntries(first.id);
              const points = entries
                .slice(0, 60)
                .sort((a, b) => (a.date < b.date ? -1 : 1))
                .map((e) => ({ date: e.date, value: e.value }));
              out[m.id] = {
                statName: first.name,
                points,
                today: entries.find((e) => e.date === todayISO)?.value ?? null,
                total: entries.reduce((sum, e) => sum + e.value, 0),
              };
            } catch {
              out[m.id] = null;
            }
          })
        );
        setSparks(out);
      })
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? "Pursuits need migration 0013 — run supabase/migrations/0013_pursuits.sql in the Supabase SQL Editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = pursuits.filter((p) => p.isMember);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">My pursuits</h1>

      {mine.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {mine.map((p) => (
            <Link key={p.id} href={pursuitHref(p)} className="rounded-full border bg-surface px-3 py-1 text-sm font-medium hover:text-accent">
              {p.name}
            </Link>
          ))}
          <Link href="/pursuits/explore" className="rounded-full border px-3 py-1 text-sm text-muted hover:text-accent">Explore →</Link>
        </div>
      )}
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {mine.map((p) => {
            const sp = sparks[p.id];
            return (
              <Link key={p.id} href={pursuitHref(p)} className="card p-4 transition hover:-translate-y-0.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-semibold">{p.name}</h2>
                  <span className="text-xs text-faint">{p.memberCount} member{p.memberCount === 1 ? "" : "s"}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{p.description || "No description."}</p>
                {sp && sp.points.length > 1 && (
                  <div className="mt-2">
                    <div className="h-14">
                      <ResponsiveContainer>
                        <LineChart data={sp.points}>
                          <Tooltip labelFormatter={(d) => String(d)} formatter={(v: number) => [v, sp.statName]} />
                          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-faint">
                      {sp.statName}: today {sp.today ?? "—"} · total {Math.round(sp.total).toLocaleString()}
                    </p>
                  </div>
                )}
                <p className="mt-2 text-xs text-faint">
                  by {p.ownerName}{p.isOwner && " (you)"} · {p.isPublic ? "public" : "invite-only"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-1 font-semibold">Start a pursuit</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Chess)" className="w-44 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="One-line description" className="min-w-56 flex-1 rounded-lg border bg-surface px-2 py-2 text-sm" />
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            public
          </label>
          <button
            onClick={() => {
              if (!name.trim()) return;
              createPursuit(name.trim(), desc.trim(), isPublic)
                .then(() => {
                  setName("");
                  setDesc("");
                  setIsPublic(false);
                  reload();
                })
                .catch((e) => setError(String(e.message ?? e)));
            }}
            disabled={!name.trim()}
            className="btn-primary"
          >
            Create
          </button>
        </div>
        <p className="mt-1 text-xs text-faint">Invite-only by default. Public pursuits appear in Explore and need a unique name.</p>
      </div>
    </div>
  );
}
