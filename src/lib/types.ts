import type { Bucket } from "./categories";

/** One 15-minute slot of one day. Matches table day_entries. */
export interface DayEntry {
  date: string; // ISO yyyy-mm-dd
  slot: number; // 0..95 (00:00 .. 23:45)
  category: number; // parent category code 0..9
  label: string | null; // personal subcategory / free text ("Mary", "rna-seq")
}

/** Per-day footer metrics from the month sheets. Matches table day_metrics. */
export interface DayMetrics {
  date: string;
  emotionalScore: number | null;
  tired: number | null;
  startFriction: number | null;
  endBrainFatigue: number | null;
  deepTime: number | null;
  weightKg: number | null;
  notes: string | null;
}

/** One exercise on one date. Matches table lift_entries. */
export interface LiftEntry {
  date: string;
  exercise: string;
  weightKg: number | null;
  reps: string | null; // kept as text: "2", "AMRAP", "2 + 10"
  sets: number | null;
  notes: string | null;
}

/** One named daily number (bodyweight, run time, ...). Matches table daily_metrics. */
export interface DailyMetric {
  date: string;
  metric: string;
  value: number | null;
  textValue: string | null;
}

export interface BucketTotals {
  productive: number;
  brainrot: number;
  other: number;
}

export type BucketSettings = Record<number, Bucket>;

/** A raw sheet as a matrix of cell values (what SheetJS gives us, normalized). */
export type CellValue = string | number | Date | null;
export type SheetMatrix = CellValue[][];
