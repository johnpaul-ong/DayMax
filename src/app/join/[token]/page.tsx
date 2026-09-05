"use client";

/**
 * Join a track from an invite link. Under-18 accounts must tick guardian
 * acknowledgment (enforced again in the database, not just here).
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { acceptInvite, getInviteInfo, type InviteInfo } from "@/lib/friends";
import { fetchProfile } from "@/lib/data";

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [isMinor, setIsMinor] = useState(false);
  const [guardianAck, setGuardianAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getInviteInfo(token)
      .then(setInfo)
      .catch((e) => setError(String(e.message ?? e)));
    fetchProfile()
      .then((p) => {
        if (p.birthDate) {
          const age = (Date.now() - new Date(p.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000);
          setIsMinor(age < 18);
        }
      })
      .catch(() => {});
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(token, guardianAck);
      router.push("/friends");
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm card p-6">
      <h1 className="mb-1 text-xl font-bold">Join a track</h1>
      {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!info ? (
        <p className="text-sm text-muted">Checking invite…</p>
      ) : !info.valid ? (
        <p className="text-sm text-muted">{info.reason ?? "This invite is not valid."}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            <b>{info.ownerName ?? "A friend"}</b> invited you to <b>{info.trackName}</b> ({info.trackKind === "day" ? "productivity ranking" : "lift compare"}).
          </p>
          <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            You join with sharing set to <b>totals only</b>: friends see your hours per bucket and focus score — never
            your labels or notes. You can change this (or go hidden) any time on the Friends page.
          </p>
          {isMinor && (
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={guardianAck} onChange={(e) => setGuardianAck(e.target.checked)} className="mt-0.5" />
              I&apos;m under 18 and my parent/guardian knows about and approves me joining this group.
            </label>
          )}
          <button onClick={() => void join()} disabled={busy || (isMinor && !guardianAck)} className="btn-primary w-full">
            {busy ? "Joining…" : "Join track"}
          </button>
        </>
      )}
    </div>
  );
}
