"use client";

/**
 * Export a month back to an .xlsx grid that looks like the original
 * spreadsheet. This is the backup path and the "I still love Excel" path.
 */

import { useState } from "react";
import { fetchDayEntries, fetchDayMetrics } from "@/lib/data";
import { buildMonthGridXlsx } from "@/lib/xlsxIO";

export default function ExportPage() {
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
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
    </div>
  );
}
