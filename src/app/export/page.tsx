"use client";

/**
 * Export a month back to an .xlsx grid that looks like the original
 * spreadsheet. This is the backup path and the "I still love Excel" path.
 */

import { useState } from "react";
import { fetchDayEntries, fetchDayMetrics } from "@/lib/data";
import { buildMonthGridXlsx } from "@/lib/xlsxIO";
import { localToday, localMonth } from "@/lib/dates";

export default function ExportPage() {
  const [ym, setYm] = useState(localMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      const from = `${ym}-01`;
      const to = `${ym}-${String(last).padStart(2, "0")}`;
      const [entries, metrics] = await Promise.all([fetchDayEntries(from, to), fetchDayMetrics(from, to)]);
      if (entries.length === 0) {
        setMsg("No data for that month yet.");
        return;
      }
      const blob = buildMonthGridXlsx(ym, entries, metrics);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `daymax_${ym}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`Exported ${entries.length} slots.`);
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-3 text-xl font-bold">Export</h1>
      <div className="card p-4">
        <label className="text-sm text-muted">
          Month
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm text-ink" />
        </label>
        <button onClick={() => void download()} disabled={busy} className="mt-3 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">
          {busy ? "Building…" : "Download .xlsx"}
        </button>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </div>

      <EverythingExport />
    </div>
  );
}

/** One workbook with ALL your data: pursuits (values + your notes), lifts, day metrics. */
function EverythingExport() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const XLSX = await import("xlsx");
      const { fetchDirectory, fetchStats, fetchMyEntries } = await import("@/lib/pursuits");
      const { fetchLifts, fetchDayMetrics } = await import("@/lib/data");
      const wb = XLSX.utils.book_new();
      const safe = (s: string) => s.replace(/[\\/*?:\[\]]/g, " ").slice(0, 28);

      let sheets = 0;
      const dirs = await fetchDirectory().catch(() => []);
      for (const p of dirs.filter((d) => d.isMember && d.kind === "custom")) {
        const stats = await fetchStats(p.id).catch(() => []);
        for (const s of stats) {
          const entries = await fetchMyEntries(s.id).catch(() => []);
          if (entries.length === 0) continue;
          const rows = entries
            .sort((a, b) => (a.date < b.date ? -1 : 1))
            .map((e) => ({ Date: e.date, [s.unit ? `Value (${s.unit})` : "Value"]: e.value, Note: e.note ?? "" }));
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safe(`${p.name} - ${s.name}`));
          sheets++;
        }
      }
      const lifts = await fetchLifts().catch(() => []);
      if (lifts.length) {
        const rows = [...lifts]
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((l) => ({ Date: l.date, Exercise: l.exercise, "Weight (kg)": l.weightKg ?? "", Reps: l.reps ?? "", Sets: l.sets ?? "", Notes: l.notes ?? "" }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Lifts");
        sheets++;
      }
      const dm = await fetchDayMetrics("2000-01-01", "2100-01-01").catch(() => []);
      if (dm.length) {
        const rows = dm.map((m) => ({
          Date: m.date, Emotional: m.emotionalScore ?? "", Tired: m.tired ?? "", "Start friction": m.startFriction ?? "",
          "Brain fatigue": m.endBrainFatigue ?? "", "Deep time": m.deepTime ?? "", "Weight (kg)": m.weightKg ?? "", Notes: m.notes ?? "",
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Day metrics");
        sheets++;
      }
      if (sheets === 0) {
        setMsg("Nothing to export yet.");
        return;
      }
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `daymax_everything_${localToday()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`Exported ${sheets} sheets.`);
    } catch (e: any) {
      setMsg(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4 p-4">
      <h2 className="font-semibold">Everything else</h2>
      <p className="mb-2 text-sm text-muted">
        One workbook with every pursuit stat (values and your private notes), your lift history, and your day metrics.
        Your data is yours — take it anywhere.
      </p>
      <button onClick={() => void download()} disabled={busy} className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">
        {busy ? "Building…" : "Download everything (.xlsx)"}
      </button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}
