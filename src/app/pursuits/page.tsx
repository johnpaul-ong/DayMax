"use client";

/**
 * My pursuits: everything you're a member of, plus create your own.
 * Life and Lifts are built-in; everything else is yours to invent.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPursuit, fetchDirectory, type Pursuit } from "@/lib/pursuits";

export function pursuitHref(p: Pursuit): string {
  if (p.kind === "life") return "/day";
  if (p.kind === "lifts") return "/lifts";
  return `/pursuits/${p.id}`;
}

export default function PursuitsPage() {
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  function reload() {
    fetchDirectory()
      .then(setPursuits)
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? "Pursuits need migration 0013 — run supabase/migrations/0013_pursuits.sql in the Supabase SQL Editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  const mine = pursuits.filter((p) => p.isMember);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">My pursuits</h1>
      <p className="mb-4 text-sm text-muted">
        The things you're chasing. Each pursuit has its own stats — daily targets, ratings, whatever fits — and its own
        leaderboard among members. <Link href="/pursuits/explore" className="font-medium text-accent hover:underline">Explore what others pursue →</Link>
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {mine.map((p) => (
            <Link key={p.id} href={pursuitHref(p)} className="card p-4 transition hover:-translate-y-0.5">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold">{p.name}</h2>
                <span className="text-xs text-faint">{p.memberCount} member{p.memberCount === 1 ? "" : "s"}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{p.description || "No description."}</p>
              <p className="mt-2 text-xs text-faint">
                by {p.ownerName}{p.isOwner && " (you)"} · {p.isPublic ? "public" : "invite-only"}
              </p>
            </Link>
          ))}
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-1 font-semibold">Start a pursuit</h2>
        <p className="mb-3 text-sm text-muted">Chess, 500 words a day, cold showers — name it, then add its stats on the pursuit page.</p>
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
