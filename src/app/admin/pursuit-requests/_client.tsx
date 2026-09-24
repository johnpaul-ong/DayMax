"use client";

/**
 * Admin queue viewer: list requests filtered by status, drill into one,
 * edit reviewer fields, approve / reject / mark implemented, and copy the
 * coordinator's brief template to clipboard for pasting into a build
 * session. Deletes are behind a small confirmation because they're rare.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteRequest,
  fetchAllRequests,
  formatBrief,
  updateRequest,
  type PursuitRequest,
  type PursuitRequestStatus,
} from "@/lib/pursuitRequests";

const STATUSES: PursuitRequestStatus[] = ["pending", "approved", "rejected", "implemented"];

export default function AdminClient() {
  const [filter, setFilter] = useState<PursuitRequestStatus | "all">("pending");
  const [rows, setRows] = useState<PursuitRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAllRequests(filter === "all" ? undefined : { status: filter });
      setRows(all);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void reload(); }, [reload]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  return (
    <div className="mx-auto max-w-5xl p-3 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Pursuit requests</h1>
        <div className="ml-auto flex items-center gap-1">
          {(["pending", "approved", "rejected", "implemented", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${filter === s ? "bg-accent text-accent-contrast" : "bg-surface-2 text-muted hover:text-ink"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs font-medium text-danger">{error}</p>}
      {loading && <p className="text-xs text-muted">Loading…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">
          {rows.length === 0 && !loading && <li className="text-xs text-faint">No requests match this filter.</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-lg border p-2 text-left text-xs transition ${r.id === selectedId ? "border-accent bg-accent-soft" : "bg-surface hover:border-accent-soft"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">{r.status}</span>
                  <span className="text-faint tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</span>
                  <span className="ml-auto font-mono text-faint">{r.userId.slice(0, 8)}</span>
                </div>
                <p className="mt-1 line-clamp-2">{r.sentence}</p>
              </button>
            </li>
          ))}
        </ul>

        <div>
          {selected ? (
            <Detail request={selected} onChanged={reload} />
          ) : (
            <p className="text-xs text-faint">Pick a request to review it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ request, onChanged }: { request: PursuitRequest; onChanged: () => Promise<void> }) {
  const [notes, setNotes] = useState(request.reviewerNotes ?? "");
  const [response, setResponse] = useState(request.reviewerResponse ?? "");
  const [implementedId, setImplementedId] = useState(request.implementedPursuitId ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setNotes(request.reviewerNotes ?? "");
    setResponse(request.reviewerResponse ?? "");
    setImplementedId(request.implementedPursuitId ?? "");
    setError(null);
    setCopied(false);
  }, [request.id]);

  async function saveFields() {
    setSaving("fields");
    setError(null);
    try {
      await updateRequest(request.id, {
        reviewerNotes: notes || null,
        reviewerResponse: response || null,
      });
      await onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  async function setStatus(status: PursuitRequestStatus) {
    setSaving(status);
    setError(null);
    try {
      const patch: Parameters<typeof updateRequest>[1] = {
        status,
        reviewerNotes: notes || null,
        reviewerResponse: response || null,
      };
      if (status === "implemented") {
        patch.implementedPursuitId = implementedId.trim() || null;
      }
      await updateRequest(request.id, patch);
      await onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(formatBrief(request));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e: any) {
      setError("Clipboard blocked — brief below to copy manually.");
    }
  }

  async function del() {
    if (!confirm("Delete this request? Only do this for spam.")) return;
    setSaving("delete");
    try {
      await deleteRequest(request.id);
      await onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
        <span className="font-mono text-faint">req {request.id.slice(0, 8)}</span>
        <span className="font-mono text-faint">user {request.userId.slice(0, 8)}</span>
        <span className="tabular-nums">{new Date(request.createdAt).toLocaleString()}</span>
        <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium">{request.status}</span>
      </div>

      <div>
        <div className="text-xs font-semibold text-muted">Sentence</div>
        <p className="mt-1">{request.sentence}</p>
      </div>
      {request.context && (
        <div>
          <div className="text-xs font-semibold text-muted">Context</div>
          <p className="mt-1 whitespace-pre-line text-sm">{request.context}</p>
        </div>
      )}

      <label className="block text-xs">
        <div className="text-muted">Reviewer notes (private)</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border bg-surface px-2 py-1 text-sm"
        />
      </label>
      <label className="block text-xs">
        <div className="text-muted">Reply to requester (public)</div>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border bg-surface px-2 py-1 text-sm"
        />
      </label>

      <label className="block text-xs">
        <div className="text-muted">Implemented pursuit id (uuid, when shipped)</div>
        <input
          value={implementedId}
          onChange={(e) => setImplementedId(e.target.value)}
          placeholder="paste the pursuits.id row uuid…"
          className="mt-1 w-full rounded-lg border bg-surface px-2 py-1 font-mono text-xs"
        />
      </label>

      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={saveFields} disabled={saving !== null} className="btn-ghost py-1 text-xs">{saving === "fields" ? "Saving…" : "Save fields"}</button>
        <button onClick={() => setStatus("approved")} disabled={saving !== null} className="btn-primary py-1 text-xs">Approve</button>
        <button onClick={() => setStatus("rejected")} disabled={saving !== null} className="btn-ghost py-1 text-xs text-danger">Reject</button>
        <button onClick={() => setStatus("implemented")} disabled={saving !== null || !implementedId.trim()} className="btn-ghost py-1 text-xs">Mark implemented</button>
        <button onClick={copyBrief} className="btn-ghost py-1 text-xs">{copied ? "Copied ✓" : "Copy brief"}</button>
        <button onClick={del} disabled={saving !== null} className="ml-auto btn-ghost py-1 text-xs text-danger">Delete</button>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Preview brief</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed">{formatBrief(request)}</pre>
      </details>
    </div>
  );
}
