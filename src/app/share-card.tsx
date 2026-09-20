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
import { categoryName, HOURS_PER_SLOT, resolveCategoryColor, SLOTS_PER_DAY } from "@/lib/categories";
import { fetchAllDayEntries } from "@/lib/data";
import { localToday } from "@/lib/dates";
import { bucketize, focusScore, hoursByCategory, workMax } from "@/lib/ranking";
import { defaultBuckets } from "@/lib/categories";
import { DEFAULT_BUCKET_COLORS, loadBucketColors } from "@/lib/theme";

const W = 1080;
const H = 1080;
const PAD = 64;

/**
 * The grid used to eat 620px of a 1080px card, which made it the whole poster
 * and left no room to say what any of the colours meant. It is smaller now,
 * with a legend beside it and the per-category numbers underneath — the shape
 * is still the hook, but the card can be read without the app open.
 */
const GRID_TOP = 186;
const GRID_H = 400;
const LEGEND_W = 280;
const GRID_GAP = 28;
const GRID_W = W - PAD * 2 - LEGEND_W - GRID_GAP;

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

      /** Truncate to fit a column. Long category names used to run into the numbers. */
      const fit = (text: string, maxW: number) => {
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
        return t + "…";
      };

      const css = getComputedStyle(document.documentElement);
      const bg = css.getPropertyValue("--page").trim() || "#faf9f6";
      const ink = css.getPropertyValue("--ink").trim() || "#1a1a1a";
      const muted = css.getPropertyValue("--muted").trim() || "#6b7280";
      const colors = loadBucketColors() ?? DEFAULT_BUCKET_COLORS;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = ink;
      ctx.font = "700 56px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(`My ${year} in 15-minute slots`, PAD, 96);

      ctx.fillStyle = muted;
      ctx.font = "400 28px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(displayName ? `${displayName} · DayMax` : "DayMax", PAD, 140);

      // one column per day, 96 stacked cells — the Year view, at poster size
      const byDate = new Map<string, Map<number, number>>();
      for (const e of mine) {
        if (!byDate.has(e.date)) byDate.set(e.date, new Map());
        byDate.get(e.date)!.set(e.slot, e.category);
      }
      const days = [...byDate.keys()].sort();
      const colW = days.length ? Math.max(1, GRID_W / days.length) : 1;
      const cellH = GRID_H / SLOTS_PER_DAY;

      // categoryColor() now returns a CSS var() reference for theme-
      // switching in the DOM; canvas.fillStyle CANNOT parse var(), so
      // we resolve to a concrete hex first. resolveCategoryColor()
      // reads the computed style off :root and falls back to the light
      // hex when the DOM isn't available. Without this the whole grid
      // paints black (previous fillStyle) on the shared PNG.
      days.forEach((d, i) => {
        const slots = byDate.get(d)!;
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
          const cat = slots.get(s);
          ctx.fillStyle = cat != null ? resolveCategoryColor(cat) : "rgba(0,0,0,0.04)";
          ctx.fillRect(PAD + i * colW, GRID_TOP + s * cellH, Math.max(1, colW - 0.4), cellH);
        }
      });

      // Hours per category, biggest first — drives both the legend and the table.
      //
      // Plus an "Unlogged" row, which is the whole reason the card used to say
      // 23.1h a day instead of 24: a day with 90 of its 96 slots filled really
      // does only account for 22.5 hours. The missing time is real, so it gets
      // a row rather than being quietly left out of the sum.
      const catHours = hoursByCategory(mine);
      const logged = Object.values(catHours).reduce((sum, h) => sum + h, 0);
      const unlogged = Math.max(0, days.length * 24 - logged);
      const rows: Array<{ name: string; color: string; hours: number }> = Object.entries(catHours)
        .map(([code, hours]) => ({ name: categoryName(Number(code)), color: resolveCategoryColor(Number(code)), hours }))
        .filter((c) => c.hours > 0)
        .sort((a, b) => b.hours - a.hours);
      if (unlogged >= 0.25) rows.push({ name: "Unlogged", color: "rgba(128,128,128,0.35)", hours: unlogged });
      const totalHours = logged + unlogged;
      const perDay = (h: number) => (days.length ? h / days.length : 0);

      // legend, down the right-hand side of the grid
      const legendX = PAD + GRID_W + GRID_GAP;
      ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
      rows.slice(0, 12).forEach((c, i) => {
        const y = GRID_TOP + 16 + i * 30;
        ctx.fillStyle = c.color;
        ctx.fillRect(legendX, y - 13, 16, 16);
        ctx.fillStyle = ink;
        ctx.fillText(fit(c.name, LEGEND_W - 26), legendX + 26, y);
      });

      // the headline numbers
      const totals = bucketize(catHours, defaultBuckets());
      const fs = focusScore(totals);
      const wm = workMax(totals);
      const stats: Array<[string, string, string]> = [
        [`${days.length}`, "days logged", ink],
        [`${Math.round(totals.productive).toLocaleString()}h`, "productive", colors.productive],
        [`${Math.round(totals.brainrot).toLocaleString()}h`, "brainrot", colors.brainrot],
        [`${wm ?? "—"}`, "WorkMax", ink],
        [`${fs ?? "—"}`, "focus", muted],
      ];
      const statsY = GRID_TOP + GRID_H + 74;
      // "1,204h" next to "612h" collided at a fixed 52px, so measure first and
      // step the size down until the widest number clears its column.
      const slotW = (W - PAD * 2) / stats.length;
      let bigSize = 52;
      for (; bigSize > 32; bigSize -= 2) {
        ctx.font = `700 ${bigSize}px ui-sans-serif, system-ui, sans-serif`;
        if (stats.every(([big]) => ctx.measureText(big).width <= slotW - 16)) break;
      }
      stats.forEach(([big, small, color], i) => {
        const x = PAD + i * slotW;
        ctx.fillStyle = color;
        ctx.font = `700 ${bigSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(big, x, statsY);
        ctx.fillStyle = muted;
        ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(small, x, statsY + 36);
      });

      // every category, with its total and its daily average — two columns
      const COL_X = [PAD, PAD + 508];
      const NUM_X = 330; // right edge of the "total" column, relative to COL_X
      const AVG_X = 444; // right edge of the "average" column
      const tableTop = statsY + 100;

      ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = muted;
      COL_X.forEach((cx) => {
        ctx.textAlign = "left";
        ctx.fillText("CATEGORY", cx + 24, tableTop);
        ctx.textAlign = "right";
        ctx.fillText("TOTAL", cx + NUM_X, tableTop);
        ctx.fillText("A DAY", cx + AVG_X, tableTop);
      });
      ctx.textAlign = "left";

      // 28px rows, not 32: the Unlogged row makes eleven, which at the old
      // spacing pushed the total line into the footer.
      const ROW_H = 28;
      const shown = rows.slice(0, 12);
      const perCol = Math.ceil(shown.length / 2) || 1;
      shown.forEach((c, i) => {
        const cx = COL_X[Math.floor(i / perCol)];
        const y = tableTop + 34 + (i % perCol) * ROW_H;
        ctx.fillStyle = c.color;
        ctx.fillRect(cx, y - 12, 14, 14);
        ctx.fillStyle = ink;
        ctx.font = "400 22px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(fit(c.name, NUM_X - 24 - 90), cx + 24, y);
        ctx.textAlign = "right";
        ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(`${Math.round(c.hours).toLocaleString()}h`, cx + NUM_X, y);
        ctx.fillStyle = muted;
        ctx.fillText(`${perDay(c.hours).toFixed(1)}h`, cx + AVG_X, y);
        ctx.textAlign = "left";
      });

      // the line that adds it all up, directly above the footer
      const sumY = tableTop + 34 + perCol * ROW_H + 30;
      ctx.strokeStyle = "rgba(128,128,128,0.35)";
      ctx.beginPath();
      ctx.moveTo(PAD, sumY - 26);
      ctx.lineTo(W - PAD, sumY - 26);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = "700 28px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("Every hour", PAD, sumY);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(totalHours).toLocaleString()}h`, COL_X[1] + NUM_X, sumY);
      ctx.fillText(`${perDay(totalHours).toFixed(1)}h`, COL_X[1] + AVG_X, sumY);
      ctx.textAlign = "left";

      ctx.fillStyle = muted;
      ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(
        `${Math.round(mine.length * HOURS_PER_SLOT).toLocaleString()} hours accounted for · daymax.me`,
        PAD,
        H - 44
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
