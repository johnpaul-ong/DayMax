"use client";

/**
 * Explore: every pursuit you can see — built-ins, public ones, and yours —
 * with owners and member counts. Join public ones with one click.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchDirectory, joinPursuit, leavePursuit, type Pursuit, pursuitHref } from "@/lib/pursuits";

export default function ExplorePage() {
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetchDirectory()
      .then(setPursuits)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Explore pursuits</h1>
      <p className="mb-4 text-sm text-muted">Join one and you can log its stats and appear on its leaderboard.</p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Pursuit</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {pursuits.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Link href={pursuitHref(p)} className="font-medium hover:text-accent hover:underline">{p.name}</Link>
                    <p className="text-xs text-faint">{p.description}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{p.ownerName}{p.isOwner && " (you)"}</td>
                  <td className="px-3 py-2 tabular-nums">{p.memberCount}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {p.isMember ? (
                      p.isOwner ? (
                        <span className="text-xs text-faint">owner</span>
                      ) : (
                        <button onClick={() => void leavePursuit(p.id).then(reload).catch((e) => setError(String(e.message ?? e)))} className="text-xs text-danger hover:opacity-70">
                          leave
                        </button>
                      )
                    ) : (
                      <button onClick={() => void joinPursuit(p.id).then(reload).catch((e) => setError(String(e.message ?? e)))} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-contrast">
                        Join
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
