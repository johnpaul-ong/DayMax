"use client";

/**
 * Download your year as a PNG.
 *
 * The app has no way for anything to leave it. Your year-in-weeks grid is the
 * most distinctive thing DayMax produces, and it's currently trapped in a
 * browser tab. Drawn on a canvas rather than screenshotted so it comes out at a
 * fixed, postable size regardless of the device.
 *
 * No usernames, no labels — just your shape of year. Nothing here identifies
 * anyone, which is what makes it safe to post.
 */

import { useRef, useState } from "react";
import { categoryColor, HOURS_PER_SLOT, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries } from "@/lib/data";
import { localToday } from "@/lib/dates";
import { bucketize, focusScore, hoursByCategory, workMax } from "@/lib/ranking";
import { defaultBuckets } from "@/lib/categories";
import { DEFAULT_BUCKET_COLORS, loadBucketColors } from "@/lib/theme";

const W = 1080;
const H = 1080;

export default function ShareCard({ displayName }: { displayName?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function build() {
    setBusy(true);
    try {
      const entries = await fetchAllDayEntries();
      const year = localToday().slice(0, 4);
      const mine = entries.filter((e) => e.date.startsWith(year));

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const css = getComputedStyle(document.documentElement);
      const bg = css.getPropertyValue("--page").trim() || "#faf9f6";
      const ink = css.getPropertyValue("--ink").trim() || "#1a1a1a";
      const muted = css.getPropertyValue("--muted").trim() || "#6b7280";
      const colors = loadBucketColors() ?? DEFAULT_BUCKET_COLORS;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = ink;
      ctx.font = "700 56px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(`My ${year} in 15-minute slots`, 64, 96);

      ctx.fillStyle = muted;
      ctx.font = "400 28px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(displayName ? `${displayName} · DayMax` : "DayMax", 64, 140);

      // one column per day, 96 stacked cells — the Year view, at poster size
      const byDate = new Map<string, Map<number, number>>();
      for (const e of mine) {
        if (!byDate.has(e.date)) byDate.set(e.date, new Map());
        byDate.get(e.date)!.set(e.slot, e.category);
      }
      const days = [...byDate.keys()].sort();
      const gridTop = 190;
      const gridH = 620;
      const gridW = W - 128;
      const colW = days.length ? Math.max(1, gridW / days.length) : 1;
      const cellH = gridH / SLOTS_PER_DAY;

      days.forEach((d, i) => {
        const slots = byDate.get(d)!;
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
          const cat = slots.get(s);
          ctx.fillStyle = cat != null ? categoryColor(cat) : "rgba(0,0,0,0.04)";
          ctx.fillRect(64 + i * colW, gridTop + s * cellH, Math.max(1, colW - 0.4), cellH);
        }
      });

      // the numbers underneath
      const totals = bucketize(hoursByCategory(mine), defaultBuckets());
      const fs = focusScore(totals);
      const wm = workMax(totals);
      const stats: Array<[string, string, string]> = [
        [`${days.length}`, "days logged", ink],
        [`${Math.round(totals.productive).toLocaleString()}h`, "productive", colors.productive],
        [`${Math.round(totals.brainrot).toLocaleString()}h`, "brainrot", colors.brainrot],
        [`${wm ?? "—"}`, "WorkMax", ink],
        [`${fs ?? "—"}`, "focus", muted],
      ];
      const y = gridTop + gridH + 110;
      stats.forEach(([big, small, color], i) => {
        const x = 64 + i * ((W - 128) / stats.length);
        ctx.fillStyle = color;
        ctx.font = "700 52px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(big, x, y);
        ctx.fillStyle = muted;
        ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(small, x, y + 36);
      });

      ctx.fillStyle = muted;
      ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(
        `${Math.round(mine.length * HOURS_PER_SLOT).toLocaleString()} hours accounted for · daymax.me`,
        64,
        H - 56
      );

      setUrl(canvas.toDataURL("image/png"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="mb-1 font-semibold">Share your year</h2>
      <p className="mb-3 text-sm text-muted">
        A picture of your year as 15-minute slots. No names, no labels — just the shape of it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void build()} disabled={busy} className="btn-primary">
          {busy ? "Drawing…" : url ? "Redraw" : "Make image"}
        </button>
        {url && (
          <a href={url} download={`daymax-${localToday().slice(0, 4)}.png`} className="btn-ghost">
            Download PNG
          </a>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Your year in 15-minute slots" className="mt-3 w-full rounded-xl border" />
      )}
    </div>
  );
}
