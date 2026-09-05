"use client";

/**
 * Client-side data access. All queries go through Supabase with RLS,
 * so a signed-in user can only ever read/write their own rows.
 */

import { createClient } from "@/lib/supabase/client";
import { defaultBuckets, type Bucket } from "./categories";
import type { BucketSettings, DailyMetric, DayEntry, DayMetrics, LiftEntry } from "./types";

async function uid(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

// --- day entries -------------------------------------------------------------

export async function fetchDayEntries(fromDate: string, toDate: string): Promise<DayEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("day_entries")
    .select("date, slot, category, label")
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date")
    .order("slot");
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, date: String(r.date) }));
}

export async function fetchAllDayEntries(): Promise<DayEntry[]> {
  const supabase = createClient();
  const all: DayEntry[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("day_entries")
      .select("date, slot, category, label")
      .order("date")
      .order("slot")
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data.map((r) => ({ ...r, date: String(r.date) })));
    if (data.length < page) break;
  }
  return all;
}

export async function upsertDayEntries(entries: DayEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const supabase = createClient();
  const user_id = await uid();
  const rows = entries.map((e) => ({ ...e, user_id, updated_at: new Date().toISOString() }));
  // chunk to stay under payload limits
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("day_entries")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,date,slot" });
    if (error) throw error;
  }
}

export async function deleteDayEntries(date: string, slots: number[]): Promise<void> {
  if (slots.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.from("day_entries").delete().eq("date", date).in("slot", slots);
  if (error) throw error;
}

// --- day metrics -------------------------------------------------------------

export async function fetchDayMetrics(fromDate: string, toDate: string): Promise<DayMetrics[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("day_metrics")
    .select("date, emotional_score, tired, start_friction, end_brain_fatigue, deep_time, weight_kg, notes")
    .gte("date", fromDate)
    .lte("date", toDate);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    date: String(r.date),
    emotionalScore: r.emotional_score,
    tired: r.tired,
    startFriction: r.start_friction,
    endBrainFatigue: r.end_brain_fatigue,
    deepTime: r.deep_time,
    weightKg: r.weight_kg,
    notes: r.notes,
  }));
}

export async function upsertDayMetrics(metrics: DayMetrics[]): Promise<void> {
  if (metrics.length === 0) return;
  const supabase = createClient();
  const user_id = await uid();
  const rows = metrics.map((m) => ({
    user_id,
    date: m.date,
    emotional_score: m.emotionalScore,
    tired: m.tired,
    start_friction: m.startFriction,
    end_brain_fatigue: m.endBrainFatigue,
    deep_time: m.deepTime,
    weight_kg: m.weightKg,
    notes: m.notes,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("day_metrics").upsert(rows, { onConflict: "user_id,date" });
  if (error) throw error;
}

// --- lifts -------------------------------------------------------------------

export async function fetchLifts(): Promise<Array<LiftEntry & { id: number }>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("lift_entries")
    .select("id, date, exercise, weight_kg, reps, sets, notes")
    .order("date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    date: String(r.date),
    exercise: r.exercise,
    weightKg: r.weight_kg,
    reps: r.reps,
    sets: r.sets,
    notes: r.notes,
  }));
}

export async function insertLifts(lifts: LiftEntry[]): Promise<void> {
  if (lifts.length === 0) return;
  const supabase = createClient();
  const user_id = await uid();
  const rows = lifts.map((l) => ({
    user_id,
    date: l.date,
    exercise: l.exercise,
    weight_kg: l.weightKg,
    reps: l.reps,
    sets: l.sets,
    notes: l.notes,
  }));
  const { error } = await supabase.from("lift_entries").insert(rows);
  if (error) throw error;
}

export async function deleteLift(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("lift_entries").delete().eq("id", id);
  if (error) throw error;
}

// --- daily metrics -------------------------------------------------------------

export async function upsertDailyMetrics(metrics: DailyMetric[]): Promise<void> {
  if (metrics.length === 0) return;
  const supabase = createClient();
  const user_id = await uid();
  const rows = metrics.map((m) => ({
    user_id,
    date: m.date,
    metric: m.metric,
    value: m.value,
    text_value: m.textValue,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("daily_metrics")
    .upsert(rows, { onConflict: "user_id,date,metric" });
  if (error) throw error;
}

export async function fetchDailyMetrics(metric: string): Promise<DailyMetric[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("daily_metrics")
    .select("date, metric, value, text_value")
    .eq("metric", metric)
    .order("date");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    date: String(r.date),
    metric: r.metric,
    value: r.value,
    textValue: r.text_value,
  }));
}

// --- bucket settings ----------------------------------------------------------

export async function fetchBucketSettings(): Promise<BucketSettings> {
  const supabase = createClient();
  const { data, error } = await supabase.from("bucket_settings").select("category, bucket");
  if (error) throw error;
  const settings = defaultBuckets();
  for (const row of data ?? []) settings[row.category] = row.bucket as Bucket;
  return settings;
}

export async function saveBucketSettings(settings: BucketSettings): Promise<void> {
  const supabase = createClient();
  const user_id = await uid();
  const rows = Object.entries(settings).map(([category, bucket]) => ({
    user_id,
    category: Number(category),
    bucket,
  }));
  const { error } = await supabase
    .from("bucket_settings")
    .upsert(rows, { onConflict: "user_id,category" });
  if (error) throw error;
}
