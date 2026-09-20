/**
 * Daily feed for a challenge -- Phase 2. Posts, comments, likes,
 * image uploads. Everything speaks to migration 0041.
 *
 * The whole surface is per-day: fetchFeed(challenge, date) is what
 * the client asks for, and the challenge page shows a day picker
 * across the top of the feed.
 */

import { createClient } from "./supabase/client";

const BUCKET = "challenge-images";

export interface FeedPost {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  team: string;
  body: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  myLike: boolean;
  mine: boolean;
}

export interface FeedComment {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  myLike: boolean;
  mine: boolean;
}

async function uid(): Promise<string> {
  const { data } = await createClient().auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

function publicImageUrl(path: string | null): string | null {
  if (!path) return null;
  const supabase = createClient();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

/** One day's posts on a challenge, ordered oldest → newest. */
export async function fetchFeed(challengeId: string, date: string): Promise<FeedPost[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("challenge_day_feed", {
    p_challenge: challengeId,
    p_date: date,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    team: r.team,
    body: r.body,
    imagePath: r.image_path,
    imageUrl: publicImageUrl(r.image_path),
    createdAt: r.created_at,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    myLike: r.my_like,
    mine: r.mine,
  }));
}

export async function fetchComments(postId: string): Promise<FeedComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("challenge_post_comments_for", { p_post: postId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    body: r.body,
    createdAt: r.created_at,
    likeCount: r.like_count,
    myLike: r.my_like,
    mine: r.mine,
  }));
}

/**
 * Upload an image to the challenge-images bucket. Path is enforced by
 * the storage RLS: {challenge_id}/{user_id}/{uuid}.{ext}. Returns the
 * storage path (not the public URL -- the row stores the path, the
 * client resolves via getPublicUrl on read).
 */
export async function uploadPostImage(challengeId: string, file: File): Promise<string> {
  const supabase = createClient();
  const user = await uid();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Simple unique-ish name — {timestamp}-{random}.ext
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "jpg"}`;
  const path = `${challengeId}/${user}/${name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

export async function createPost(
  challengeId: string,
  date: string,
  body: string,
  imagePath: string | null,
): Promise<void> {
  const supabase = createClient();
  const user = await uid();
  const trimmed = body.trim();
  if (!trimmed && !imagePath) throw new Error("Add some text or an image");
  const { error } = await supabase.from("challenge_posts").insert({
    challenge_id: challengeId,
    user_id: user,
    post_date: date,
    body: trimmed || null,
    image_path: imagePath,
  });
  if (error) throw error;
}

export async function deletePost(postId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("challenge_posts").delete().eq("id", postId);
  if (error) throw error;
}

export async function togglePostLike(postId: string, currentlyLiked: boolean): Promise<void> {
  const supabase = createClient();
  const user = await uid();
  if (currentlyLiked) {
    const { error } = await supabase
      .from("challenge_post_reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user)
      .eq("kind", "like");
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("challenge_post_reactions")
      .insert({ post_id: postId, user_id: user, kind: "like" });
    if (error && !String(error.message).includes("duplicate")) throw error;
  }
}

export async function createComment(postId: string, body: string): Promise<void> {
  const supabase = createClient();
  const user = await uid();
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");
  const { error } = await supabase.from("challenge_post_comments").insert({
    post_id: postId,
    user_id: user,
    body: trimmed,
  });
  if (error) throw error;
}

export async function deleteComment(commentId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("challenge_post_comments").delete().eq("id", commentId);
  if (error) throw error;
}

export async function toggleCommentLike(commentId: string, currentlyLiked: boolean): Promise<void> {
  const supabase = createClient();
  const user = await uid();
  if (currentlyLiked) {
    const { error } = await supabase
      .from("challenge_comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", user)
      .eq("kind", "like");
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("challenge_comment_reactions")
      .insert({ comment_id: commentId, user_id: user, kind: "like" });
    if (error && !String(error.message).includes("duplicate")) throw error;
  }
}

/**
 * Realtime: fire `onChange` on any insert/update/delete in the feed
 * tables for this challenge. Caller refetches. Kept coarse (whole
 * challenge, not per-day) because the amount of data per day is small
 * and it saves multiple channel subscriptions.
 */
export function subscribeToFeed(challengeId: string, onChange: () => void): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(`challenge-feed:${challengeId}`)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "challenge_posts", filter: `challenge_id=eq.${challengeId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "challenge_post_reactions" },
      () => onChange(),
    )
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "challenge_post_comments" },
      () => onChange(),
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
