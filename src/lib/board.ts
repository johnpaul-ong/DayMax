"use client";

/**
 * Track message boards. Posts are either shared with the track or kept
 * private to their author (a diary entry nobody else sees), and the track
 * owner can switch the whole board off.
 */

import { createClient } from "@/lib/supabase/client";

export type PostVisibility = "track" | "private";

export interface BoardPost {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  body: string;
  visibility: PostVisibility;
  createdAt: string;
  editedAt: string | null;
  commentCount: number;
}

export interface PostComment {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  body: string;
  createdAt: string;
}

async function uid(): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function fetchBoard(trackId: string, limit = 50): Promise<BoardPost[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("track_board", { t: trackId, limit_n: limit });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    body: r.body,
    visibility: r.visibility,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    commentCount: Number(r.comment_count ?? 0),
  }));
}

export async function createPost(trackId: string, body: string, visibility: PostVisibility): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase
    .from("track_posts")
    .insert({ track_id: trackId, user_id, body: body.trim(), visibility });
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("track_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function setPostVisibility(id: string, visibility: PostVisibility): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("track_posts").update({ visibility }).eq("id", id);
  if (error) throw error;
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("post_comments", { p: postId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function addComment(postId: string, body: string): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const { error } = await supabase.from("track_comments").insert({ post_id: postId, user_id, body: body.trim() });
  if (error) throw error;
}

export async function deleteComment(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("track_comments").delete().eq("id", id);
  if (error) throw error;
}

export async function setBoardEnabled(trackId: string, enabled: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("tracks").update({ board_enabled: enabled }).eq("id", trackId);
  if (error) throw error;
}

/** "3m", "2h", "5d" — compact enough to sit next to a name. */
export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
