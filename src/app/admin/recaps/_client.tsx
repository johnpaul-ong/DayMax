"use client";

/**
 * Pick a finished challenge, draft recaps for everyone who lacks one, then
 * edit and approve each. Members only ever see approved recaps.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchChallenges, fetchStandings, type Challenge, type Standing } from "@/lib/challenges";
import { localToday } from "@/lib/dates";
import { RECAP_RULES } from "@/lib/recapPrompt";
import {
  challengeClosed,
  fetchLifeSummary,
  fetchRecaps,
  saveRecap,
  updateRecap,
  type LifeSummary,
  type Recap,
  type RecapStatus,
} from "@/lib/challengeRecaps";
import { generateRecaps } from "./actions";

const LABEL: Record<RecapStatus, string> = { pending_approval: "pending", visible: "approved" };

export default function AdminRecapsClient() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [allRecaps, setAllRecaps] = useState<Recap[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [cs, rs] = await Promise.all([fetchChallenges(), fetchRecaps()]);
      // Ended ones, including those still taking final logs, so recaps can be
      // approved ahead of 12:00. Standings are member-only, so only challenges
      // you are in.
      const done = cs.filter((c) => c.endsOn < localToday() && (c.isMember || c.isOwner));
      setChallenges(done);
      setAllRecaps(rs);
      setSelectedId((cur) => cur ?? done[0]?.id ?? null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const selected = challenges.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Challenge recaps</h1>
        <Link href="/admin/pursuit-requests" className="ml-auto text-xs text-muted hover:text-accent">Pursuit requests →</Link>
      </div>
      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <ul className="space-y-2">
          {challenges.length === 0 && <li className="text-xs text-faint">No finished challenges you are in.</li>}
          {challenges.map((c) => {
            const mine = allRecaps.filter((r) => r.challengeId === c.id);
            const pending = mine.filter((r) => r.status === "pending_approval").length;
            const visible = mine.filter((r) => r.status === "visible").length;
            return (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-lg border p-2 text-left text-xs transition ${c.id === selectedId ? "border-accent bg-accent-soft" : "bg-surface hover:border-accent-soft"}`}
                >
                  <div className="font-medium text-ink">{c.name}</div>
                  <div className="mt-0.5 text-faint">{c.startsOn} → {c.endsOn}</div>
                  <div className="mt-1 flex gap-2 text-[10px]">
                    {pending > 0 && <span className="rounded-full bg-warn-soft px-1.5 py-0.5 font-semibold text-warn">{pending} pending</span>}
                    <span className="text-muted">{visible}/{c.members} approved</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div>
          {selected ? (
            <ChallengeRecaps
              key={selected.id}
              challenge={selected}
              recaps={allRecaps.filter((r) => r.challengeId === selected.id)}
              onChanged={reload}
            />
          ) : (
            <p className="text-xs text-faint">Pick a challenge.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ChallengeRecaps({
  challenge,
  recaps,
  onChanged,
}: {
  challenge: Challenge;
  recaps: Recap[];
  onChanged: () => Promise<void>;
}) {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [life, setLife] = useState<LifeSummary[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStandings(challenge.id).then(setStandings).catch((e) => setError(String(e?.message ?? e)));
    fetchLifeSummary(challenge.id).then(setLife).catch(() => setLife([]));
  }, [challenge.id]);

  async function copyBrief() {
    const text = recapBrief(challenge, standings, life, !challengeClosed(challenge.endsOn));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard blocked. Use the preview below and copy it by hand.");
    }
  }

  const byUser = useMemo(() => new Map(recaps.map((r) => [r.userId, r])), [recaps]);
  const missing = standings.filter((s) => !byUser.has(s.userId)).length;

  async function generate(onlyUserId?: string) {
    setBusy(onlyUserId ?? "all");
    setError(null);
    setNote(null);
    try {
      const res = await generateRecaps(challenge.id, onlyUserId);
      setNote(
        `Drafted ${res.generated}` +
          (res.failed.length ? `, ${res.failed.length} failed: ${res.failed.map((f) => `${f.name} (${f.error})`).join("; ")}` : "") +
          ".",
      );
      await onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/challenges/${challenge.id}`} className="font-semibold hover:text-accent hover:underline">{challenge.name}</Link>
        <span className="text-xs text-faint">{challenge.metricLabel} wins</span>
        <button onClick={() => void copyBrief()} disabled={standings.length === 0} className="btn-ghost ml-auto py-1 text-xs">
          {copied ? "Copied ✓" : "Copy brief for Claude"}
        </button>
        <button
          onClick={() => void generate()}
          disabled={busy !== null || missing === 0}
          className="btn-primary py-1 text-xs"
        >
          {busy === "all" ? "Drafting…" : missing > 0 ? `Draft ${missing} missing recap${missing === 1 ? "" : "s"}` : "All drafted"}
        </button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
      <p className="text-xs text-faint">
        No API key? Copy the brief into a Claude session, then paste each recap below and approve.
        {!challengeClosed(challenge.endsOn) && " Final logs are still open: approved recaps publish at 12:00, and the numbers may still move until then."}
      </p>
      {standings.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Preview brief</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed">
            {recapBrief(challenge, standings, life, !challengeClosed(challenge.endsOn))}
          </pre>
        </details>
      )}

      <ul className="space-y-3">
        {standings.map((s, i) => (
          <li key={s.userId}>
            <RecapEditor
              challengeId={challenge.id}
              userId={s.userId}
              name={s.displayName}
              place={i + 1}
              recap={byUser.get(s.userId) ?? null}
              scheduled={!challengeClosed(challenge.endsOn)}
              busy={busy !== null}
              regenerating={busy === s.userId}
              onRegenerate={() => void generate(s.userId)}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecapEditor({
  challengeId,
  userId,
  name,
  place,
  recap,
  scheduled,
  busy,
  regenerating,
  onRegenerate,
  onChanged,
}: {
  challengeId: string;
  userId: string;
  name: string;
  place: number;
  recap: Recap | null;
  /** Challenge still in final logs: approved recaps publish at 12:00. */
  scheduled: boolean;
  busy: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
  onChanged: () => Promise<void>;
}) {
  const [body, setBody] = useState(recap?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setBody(recap?.body ?? ""); }, [recap?.body]);

  async function save(status?: RecapStatus) {
    setSaving(true);
    setError(null);
    try {
      if (recap) await updateRecap(recap.challengeId, recap.userId, { body, status });
      else await saveRecap(challengeId, userId, body, status === "visible");
      await onChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const dirty = recap != null && body.trim() !== recap.body;

  return (
    <div className="space-y-2 rounded-lg border bg-surface p-3 text-sm">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-5 text-center font-bold text-faint">{place}</span>
        <span className="font-medium text-ink">{name}</span>
        {recap ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${recap.status === "visible" ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>
            {recap.status === "visible" && scheduled ? "approved · publishes 12:00" : LABEL[recap.status]}
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-faint">no draft</span>
        )}
        {recap?.model && <span className="ml-auto font-mono text-[10px] text-faint">{recap.model}</span>}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={recap ? 4 : 2}
        maxLength={2000}
        placeholder={recap ? undefined : `Paste ${name}'s recap here…`}
        className="w-full rounded-lg border bg-surface px-2 py-1 text-sm"
      />
      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!recap && (
          <>
            <button onClick={() => void save("visible")} disabled={saving || busy || !body.trim()} className="btn-primary py-1 text-xs">Save & approve</button>
            <button onClick={() => void save()} disabled={saving || busy || !body.trim()} className="btn-ghost py-1 text-xs">Save draft</button>
          </>
        )}
        {recap && recap.status === "pending_approval" && (
          <button onClick={() => void save("visible")} disabled={saving || busy || !body.trim()} className="btn-primary py-1 text-xs">
            {dirty ? "Save & approve" : "Approve"}
          </button>
        )}
        {recap && dirty && (
          <button onClick={() => void save()} disabled={saving || busy || !body.trim()} className="btn-ghost py-1 text-xs">Save</button>
        )}
        {recap && recap.status === "visible" && (
          <button onClick={() => void save("pending_approval")} disabled={saving || busy} className="btn-ghost py-1 text-xs">Unpublish</button>
        )}
        <button onClick={onRegenerate} disabled={saving || busy} className="btn-ghost ml-auto py-1 text-xs">
          {regenerating ? "Drafting…" : recap ? "Regenerate" : "Draft"}
        </button>
      </div>
    </div>
  );
}

/**
 * Everything a Claude session needs to write this challenge's recaps: the
 * rules plus the numbers the board already shows members. Nothing else.
 */
function recapBrief(challenge: Challenge, standings: Standing[], life: LifeSummary[], provisional: boolean): string {
  const lifeBy = new Map(life.map((l) => [l.userId, l]));
  const totalDays = Math.round((Date.parse(challenge.endsOn) - Date.parse(challenge.startsOn)) / 86_400_000) + 1;
  const unit = standings[0]?.scoreUnit ?? challenge.scoreUnit;
  const fmt = (v: number | null) => (v == null ? "no score" : `${Math.round(v * 10) / 10}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);
  const rows = standings.map((s, i) => {
    const l = lifeBy.get(s.userId);
    const extra = l
      ? `, ${l.productiveHours} h productive, ${l.brainrotHours} h brainrot, ${l.focus ?? "no"}% focus, ${l.sleepHours} h sleep logged`
      : "";
    return `${i + 1}. ${s.displayName}: ${fmt(s.score)} (${s.entries} of ${totalDays} days logged${extra})`;
  });
  return [
    `Write one recap per member for the DayMax challenge below, following these rules. Return them as "Name: recap", one per line.`,
    ``,
    RECAP_RULES,
    ``,
    `Challenge: ${challenge.name}`,
    challenge.description ? `About it: ${challenge.description}` : null,
    `Window: ${challenge.startsOn} to ${challenge.endsOn} (${totalDays} days). Ranking: ${challenge.metricLabel} wins.`,
    provisional ? `NOTE: final logs are still open until 12:00, so these numbers are provisional.` : null,
    ``,
    `Final leaderboard (${standings.length} members):`,
    ...rows,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
