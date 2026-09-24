"use client";

/**
 * The "Request a custom pursuit" card + "My requests" list, mounted at the
 * bottom of /pursuits. Pursuits themselves are handmade code in this repo;
 * this queue is how a non-coding user asks for a new one and follows it
 * through review.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createRequest,
  fetchMyRequests,
  type PursuitRequest,
} from "@/lib/pursuitRequests";

const STATUS_COPY: Record<PursuitRequest["status"], { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-surface-2 text-muted" },
  approved: { label: "Approved — building", className: "bg-accent-soft text-accent" },
  rejected: { label: "Not doing this", className: "bg-danger/15 text-danger" },
  implemented: { label: "Shipped", className: "bg-ok/15 text-ok" },
};

export default function RequestCard() {
  const [sentence, setSentence] = useState("");
  const [context, setContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<PursuitRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setRequests(await fetchMyRequests());
    } catch (e: any) {
      // Anonymous users hit this before signin — quietly show empty state.
      setError(null);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    if (!sentence.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createRequest(sentence, context || null);
      setSentence("");
      setContext("");
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="card p-4">
        <h2 className="mb-1 font-semibold">Request a custom pursuit</h2>
        <p className="mb-2 text-xs text-muted">
          Every pursuit in DayMax is real code, hand-built for reliability. If you have an idea for one that&apos;s not here yet, drop it below — John reviews the queue and briefs a build for the ones worth doing.
        </p>
        <div className="flex flex-col gap-2">
          <input
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            placeholder="Track my Duolingo streak, count nights I closed the shed door…"
            maxLength={500}
            className="w-full rounded-lg border bg-surface px-2 py-2 text-sm"
          />
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Optional detail: where the data comes from, what you want to see, anything a builder would need to know."
            rows={3}
            maxLength={4000}
            className="w-full resize-y rounded-lg border bg-surface px-2 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button onClick={submit} disabled={!sentence.trim() || saving} className="btn-primary py-1 text-sm">
              {saving ? "Sending…" : "Submit request"}
            </button>
            {error && <span className="text-xs font-medium text-danger">{error}</span>}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">My requests</h2>
        {loading ? (
          <p className="text-xs text-faint">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-xs text-faint">Nothing filed yet. Requests you submit above will show up here with their status.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => {
              const s = STATUS_COPY[r.status];
              return (
                <li key={r.id} className="rounded-lg border bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}>{s.label}</span>
                    <span className="text-xs text-faint tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</span>
                    {r.status === "implemented" && r.implementedPursuitId && (
                      <Link href={`/pursuits/${r.implementedPursuitId}`} className="ml-auto text-xs text-accent hover:underline">
                        Open the pursuit →
                      </Link>
                    )}
                  </div>
                  <p className="mt-1">{r.sentence}</p>
                  {r.context && <p className="mt-1 text-xs text-muted whitespace-pre-line">{r.context}</p>}
                  {r.reviewerResponse && (
                    <div className="mt-2 rounded-md border-l-2 border-accent bg-surface-2 px-2 py-1 text-xs">
                      <span className="text-muted">Reviewer:</span> {r.reviewerResponse}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
