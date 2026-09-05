"use client";

/**
 * Friends: your tracks, who's in them, your share rule, invite links,
 * and Compare — the leaderboard. Compare shows totals and focus score only;
 * raw labels are never shown unless that member chose raw_labels.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  addTrackMember,
  createInvite,
  createTrack,
  deleteInvite,
  deleteTrack,
  fetchCompareDay,
  fetchCompareLifts,
  fetchInvites,
  fetchMembers,
  fetchTracks,
  listFriends,
  removeMember,
  setMyShareRule,
  type CompareDayRow,
  type CompareLiftRow,
  type Friendship,
  type Invite,
  type ShareRule,
  type Track,
  type TrackKind,
  type TrackMember,
} from "@/lib/friends";
import { createClient } from "@/lib/supabase/client";
import { AddFriendCard, PeopleSection } from "./social";
import { weekStart } from "@/lib/ranking";
import { DEFAULT_BUCKET_COLORS, loadBucketColors, type BucketColors } from "@/lib/theme";

const LINE_COLORS = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", "#0ea5e9", "#a78bfa", "#ec4899", "#14b8a6"];
const tickDate = (d: string) => (typeof d === "string" ? d.slice(5) : d);

const RULE_INFO: Record<ShareRule, string> = {
  hidden: "You are invisible on Compare.",
  totals_only: "Friends see your bucket totals and focus score, never labels.",
  raw_labels: "Friends can also open your day detail with labels. Most people should not pick this.",
};



export default function FriendsPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<TrackKind>("day");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetchTracks()
      .then((ts) => {
        setTracks(ts);
        if (ts.length && !open) setOpen(ts[0].id);
      })
      .catch((e) =>
        setError(
          String(e.message ?? e).includes("does not exist") || String(e.message ?? e).includes("schema cache")
            ? "Friends needs migration 0005 — run supabase/migrations/0005_friends.sql in the Supabase SQL Editor."
            : String(e.message ?? e)
        )
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">Friends</h1>
      <p className="mb-4 text-sm text-muted">
        Invite-only tracks. Compare uses totals and focus score — never your labels, unless a member explicitly shares them.
      </p>
      {error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

      <PeopleSection />

      <AddFriendCard tracks={tracks} me={me} onChanged={reload} />

      <div className="mb-6 card flex flex-wrap items-end gap-2 p-4">
        <label className="text-xs text-muted">
          New track
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. The Boys" className="mt-0.5 block w-48 rounded-lg border bg-surface px-2 py-2 text-sm text-ink" />
        </label>
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as TrackKind)} className="rounded-lg border bg-surface px-2 py-2 text-sm">
          <option value="day">Day (productivity ranking)</option>
          <option value="lifts">Lifts (progression compare)</option>
        </select>
        <button
          onClick={() => {
            if (!newName.trim()) return;
            createTrack(newName.trim(), newKind)
              .then(() => {
                setNewName("");
                reload();
              })
              .catch((e) => setError(String(e.message ?? e)));
          }}
          className="btn-primary"
        >
          Create
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : tracks.length === 0 && !error ? (
        <p className="card p-4 text-sm text-faint">No tracks yet. Create one and send your friends the invite link.</p>
      ) : (
        <div className="space-y-4">
          {tracks.map((t) => (
            <div key={t.id} className="card p-4">
              <button onClick={() => setOpen(open === t.id ? null : t.id)} className="flex w-full items-center justify-between">
                <span className="font-semibold">
                  {t.name} <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-muted">{t.kind}</span>
                  {t.isDemo && <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">demo</span>}
                </span>
                <span className="text-sm text-faint">{open === t.id ? "▲" : "▼"}</span>
              </button>
              {open === t.id && me && <TrackDetail track={t} me={me} onDeleted={reload} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrackDetail({ track, me, onDeleted }: { track: Track; me: string; onDeleted: () => void }) {
  const [members, setMembers] = useState<TrackMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isOwner = track.ownerId === me;

  function reload() {
    fetchMembers(track.id).then(setMembers).catch((e) => setErr(String(e.message ?? e)));
    if (isOwner) {
      fetchInvites(track.id).then(setInvites).catch(() => {});
      listFriends().then((fs) => setFriends(fs.filter((f) => f.status === "accepted"))).catch(() => {});
    }
  }
  useEffect(reload, [track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addableFriends = friends.filter((f) => !members.some((m) => m.userId === f.memberId));

  const myRule = members.find((m) => m.userId === me)?.shareRule ?? "totals_only";

  return (
    <div className="mt-3 border-t pt-3">
      {err && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}

      <div className="mb-3">
        <h3 className="mb-1 text-sm font-semibold">Members</h3>
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2 py-1 text-sm">
            <Link href={`/friends/${m.userId}`} className="font-medium hover:text-accent hover:underline">
              {m.displayName}
            </Link>
            {m.role === "owner" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">owner</span>}
            {m.userId === me ? (
              <select
                value={myRule}
                onChange={(e) =>
                  setMyShareRule(track.id, e.target.value as ShareRule)
                    .then(reload)
                    .catch((ex) => setErr(String(ex.message ?? ex)))
                }
                className="ml-auto rounded-lg border bg-surface px-2 py-1 text-xs"
              >
                <option value="hidden">hidden</option>
                <option value="totals_only">totals only</option>
                <option value="raw_labels">raw labels</option>
              </select>
            ) : (
              <span className="ml-auto text-xs text-faint">{m.shareRule.replace("_", " ")}</span>
            )}
            {isOwner && m.userId !== me && (
              <button onClick={() => void removeMember(track.id, m.userId).then(reload)} className="text-xs text-danger hover:opacity-70">
                remove
              </button>
            )}
          </div>
        ))}
        <p className="mt-1 text-xs text-faint">Your rule: {RULE_INFO[myRule]}</p>
        {isOwner && addableFriends.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted">Add a friend to this track:</span>
            {addableFriends.map((f) => (
              <button
                key={f.memberId}
                onClick={() => void addTrackMember(track.id, f.memberId).then(reload).catch((e) => setErr(String(e.message ?? e)))}
                className="rounded-full border px-3 py-1 text-xs hover:bg-surface-2"
              >
                + {f.displayName}
              </button>
            ))}
            <span className="w-full text-xs text-faint">They join as hidden and choose their own sharing — nobody shares data because you clicked a button.</span>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="mb-4">
          <h3 className="mb-1 text-sm font-semibold">Invites</h3>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Restrict to email (optional)" className="w-56 rounded-lg border bg-surface px-2 py-1.5 text-sm" />
            <button
              onClick={() =>
                createInvite(track.id, inviteEmail.trim() || null)
                  .then(() => {
                    setInviteEmail("");
                    reload();
                  })
                  .catch((e) => setErr(String(e.message ?? e)))
              }
              className="btn-ghost py-1.5"
            >
              New invite link
            </button>
          </div>
          {invites.filter((i) => !i.acceptedAt).map((i) => {
            const link = `${location.origin}/join/${i.token}`;
            return (
              <div key={i.id} className="flex items-center gap-2 py-0.5 text-xs">
                <code className="max-w-[16rem] truncate text-faint">{link}</code>
                {i.email && <span className="text-faint">({i.email})</span>}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(link).then(() => {
                      setCopied(i.id);
                      setTimeout(() => setCopied(null), 2000);
                    });
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  {copied === i.id ? "Copied ✓" : "Copy"}
                </button>
                <button onClick={() => void deleteInvite(i.id).then(reload)} className="text-danger hover:opacity-70">
                  revoke
                </button>
              </div>
            );
          })}
          <p className="mt-1 text-xs text-faint">Send the link however you like — WhatsApp, text. Links expire after 14 days.</p>
        </div>
      )}

      {track.kind === "day" ? <DayCompare trackId={track.id} /> : <LiftsCompare trackId={track.id} />}

      {isOwner && (
        <button
          onClick={() => {
            if (confirm(`Delete track "${track.name}" for everyone? (Nobody's diary data is deleted — only the group.)`))
              void deleteTrack(track.id).then(onDeleted);
          }}
          className="mt-4 text-xs text-danger hover:opacity-70"
        >
          Delete track
        </button>
      )}
    </div>
  );
}

function DayCompare({ trackId }: { trackId: string }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const ws = weekStart(todayISO);
  const [rows, setRows] = useState<CompareDayRow[]>([]);
  const [colors, setColors] = useState<BucketColors>(DEFAULT_BUCKET_COLORS);

  useEffect(() => {
    setColors(loadBucketColors());
    fetchCompareDay(trackId).then(setRows).catch(() => {});
  }, [trackId]);

  const board = useMemo(() => {
    const byMember = new Map<string, { name: string; rows: CompareDayRow[] }>();
    for (const r of rows) {
      if (!byMember.has(r.memberId)) byMember.set(r.memberId, { name: r.displayName, rows: [] });
      byMember.get(r.memberId)!.rows.push(r);
    }
    const agg = (list: CompareDayRow[]) => {
      const p = list.reduce((s, r) => s + r.productive, 0);
      const b = list.reduce((s, r) => s + r.brainrot, 0);
      const o = list.reduce((s, r) => s + r.other, 0);
      return { p, b, o, score: p + b > 0 ? Math.round((p / (p + b)) * 1000) / 10 : null };
    };
    return [...byMember.entries()]
      .map(([id, m]) => ({
        id,
        name: m.name,
        today: agg(m.rows.filter((r) => r.date === todayISO)),
        week: agg(m.rows.filter((r) => r.date >= ws && r.date <= todayISO)),
        all: agg(m.rows),
      }))
      .sort((a, b) => (b.week.score ?? -1) - (a.week.score ?? -1));
  }, [rows, todayISO, ws]);

  const chart = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const r of rows) {
      names.add(r.displayName);
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const scored = r.productive + r.brainrot;
      byDate.get(r.date)![r.displayName] = scored > 0 ? Math.round((r.productive / scored) * 1000) / 10 : null;
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).slice(-42), names: [...names] };
  }, [rows]);

  if (rows.length === 0) return <p className="text-sm text-faint">No shared data yet — Compare fills in once members log days.</p>;

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">Leaderboard (ranked by this week&apos;s focus score)</h3>
      <p className="mb-1 text-xs text-faint">Focus score = productive ÷ (productive + brainrot) × 100. Someone with little brainrot scores high even on a light day — hours are shown next to it for honesty.</p>
      <div className="mb-3 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Today</th>
              <th className="px-3 py-2">This week</th>
              <th className="px-3 py-2">All time</th>
            </tr>
          </thead>
          <tbody>
            {board.map((m, i) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-bold text-faint">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium">{m.name}</td>
                {[m.today, m.week, m.all].map((a, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    <span className="font-semibold">{a.score ?? "—"}</span>
                    <span className="ml-1 text-xs text-faint">
                      (<span style={{ color: colors.productive }}>{a.p.toFixed(1)}</span>/<span style={{ color: colors.brainrot }}>{a.b.toFixed(1)}</span>/<span className="text-muted">{a.o.toFixed(1)}</span>h)
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-2 text-xs text-faint">Score and hours shown together so nobody can game one stat.</p>

      <h4 className="mb-1 text-sm font-semibold">Daily focus score (/100)</h4>
      <div className="h-56 card p-2">
        <ResponsiveContainer>
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={(d) => String(d)} />
            <Legend />
            {chart.names.map((n, i) => (
              <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LiftsCompare({ trackId }: { trackId: string }) {
  const [rows, setRows] = useState<CompareLiftRow[]>([]);
  const [exercise, setExercise] = useState<string>("");

  useEffect(() => {
    fetchCompareLifts(trackId)
      .then((rs) => {
        setRows(rs);
        if (rs.length && !exercise) {
          const counts = new Map<string, number>();
          for (const r of rs) counts.set(r.exercise, (counts.get(r.exercise) ?? 0) + 1);
          setExercise([...counts.entries()].sort(([, a], [, b]) => b - a)[0][0]);
        }
      })
      .catch(() => {});
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exercises = useMemo(() => [...new Set(rows.map((r) => r.exercise))].sort(), [rows]);

  const chart = useMemo(() => {
    const filtered = rows.filter((r) => r.exercise === exercise && r.weightKg != null);
    const byDate = new Map<string, Record<string, string | number | null>>();
    const names = new Set<string>();
    for (const r of filtered) {
      names.add(r.displayName);
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
      const row = byDate.get(r.date)!;
      row[r.displayName] = Math.max(Number(row[r.displayName] ?? 0), r.weightKg!);
    }
    return { data: [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)), names: [...names] };
  }, [rows, exercise]);

  if (rows.length === 0) return <p className="text-sm text-faint">No shared lifts yet.</p>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Lift compare</h3>
        <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="rounded-lg border bg-surface px-2 py-1 text-sm">
          {exercises.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="h-56 card p-2">
        <ResponsiveContainer>
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={tickDate} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} unit="kg" />
            <Tooltip labelFormatter={(d) => String(d)} />
            <Legend />
            {chart.names.map((n, i) => (
              <Line key={n} type="monotone" strokeWidth={2.5} dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
