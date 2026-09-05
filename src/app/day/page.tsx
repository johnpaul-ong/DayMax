"use client";

/**
 * The Excel-like month grid. This page has to be FASTER than the spreadsheet
 * or DayMax loses: drag to select a range, type "0 Sleep" once, Enter.
 * Copy-yesterday for the lazy path. Keyboard arrows move the focus cell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, categoryColor, slotToTime, SLOTS_PER_DAY } from "@/lib/categories";
import { parseGridCell } from "@/lib/gridParse";
import { deleteDayEntries, fetchDayEntries, upsertDayEntries } from "@/lib/data";
import type { DayEntry } from "@/lib/types";

type CellMap = Map<string, { category: number; label: string | null }>;
const key = (date: string, slot: number) => `${date}|${slot}`;

function monthDates(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

export default function DayGridPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(todayISO.slice(0, 7));
  const dates = useMemo(() => monthDates(ym), [ym]);

  const [cells, setCells] = useState<CellMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // selection in (dayIndex, slot) space
  const [anchor, setAnchor] = useState<{ d: number; s: number } | null>(null);
  const [focus, setFocus] = useState<{ d: number; s: number } | null>(null);
  const dragging = useRef(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // zoom: 0..4 -> cell size; labels toggle shows text inside cells
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    try {
      const z = localStorage.getItem("daymax-grid-zoom");
      const l = localStorage.getItem("daymax-grid-labels");
      if (z != null) setZoom(Math.max(0, Math.min(4, Number(z))));
      if (l != null) setShowLabels(l === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("daymax-grid-zoom", String(zoom));
      localStorage.setItem("daymax-grid-labels", showLabels ? "1" : "0");
    } catch {}
  }, [zoom, showLabels]);
  const CELL_H = [12, 14, 18, 24, 32][zoom];
  const CELL_W = [40, 52, 76, 110, 150][zoom];
  const labelsVisible = showLabels;

  // arrive from the Year view: /day?m=YYYY-MM
  useEffect(() => {
    try {
      const m = new URLSearchParams(window.location.search).get("m");
      if (m && /^\d{4}-\d{2}$/.test(m)) setYm(m);
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchDayEntries(dates[0], dates[dates.length - 1])
      .then((entries) => {
        const m: CellMap = new Map();
        for (const e of entries) m.set(key(e.date, e.slot), { category: e.category, label: e.label });
        setCells(m);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [ym]); // eslint-disable-line react-hooks/exhaustive-deps

  const selection = useMemo(() => {
    if (!anchor || !focus) return null;
    return {
      d0: Math.min(anchor.d, focus.d),
      d1: Math.max(anchor.d, focus.d),
      s0: Math.min(anchor.s, focus.s),
      s1: Math.max(anchor.s, focus.s),
    };
  }, [anchor, focus]);

  const inSelection = useCallback(
    (d: number, s: number) =>
      !!selection && d >= selection.d0 && d <= selection.d1 && s >= selection.s0 && s <= selection.s1,
    [selection]
  );

  async function applyToSelection(raw: string) {
    if (!selection) return;
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : parseGridCell(trimmed);
    if (trimmed !== "" && (!parsed || parsed.category > 9)) {
      setError(`Cannot parse "${trimmed}". Use "<category number> <optional label>", e.g. "1 project".`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const next = new Map(cells);
      const upserts: DayEntry[] = [];
      const deletesByDate = new Map<string, number[]>();
      for (let d = selection.d0; d <= selection.d1; d++) {
        for (let s = selection.s0; s <= selection.s1; s++) {
          const date = dates[d];
          if (parsed) {
            next.set(key(date, s), parsed);
            upserts.push({ date, slot: s, category: parsed.category, label: parsed.label });
          } else {
            next.delete(key(date, s));
            deletesByDate.set(date, [...(deletesByDate.get(date) ?? []), s]);
          }
        }
      }
      setCells(next);
      await upsertDayEntries(upserts);
      for (const [date, slots] of deletesByDate) await deleteDayEntries(date, slots);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!focus) return;
    const move = (dd: number, ds: number, extend: boolean) => {
      e.preventDefault();
      const nf = {
        d: Math.max(0, Math.min(dates.length - 1, focus.d + dd)),
        s: Math.max(0, Math.min(SLOTS_PER_DAY - 1, focus.s + ds)),
      };
      setFocus(nf);
      if (!extend) setAnchor(nf);
    };
    if (e.key === "ArrowDown") move(0, 1, e.shiftKey);
    else if (e.key === "ArrowUp") move(0, -1, e.shiftKey);
    else if (e.key === "ArrowRight") move(1, 0, e.shiftKey);
    else if (e.key === "ArrowLeft") move(-1, 0, e.shiftKey);
    else if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void applyToSelection("");
    } else if (e.key.length === 1 && /[0-9]/.test(e.key)) {
      setInput(e.key);
      inputRef.current?.focus();
      e.preventDefault();
    }
  }

  const focusedCell = focus ? cells.get(key(dates[focus.d], focus.s)) : null;

  return (
    <div onMouseUp={() => (dragging.current = false)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">Month grid</h1>
        <input
          type="month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="rounded-lg border px-2 py-1 text-sm"
        />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void applyToSelection(input);
            }
          }}
          placeholder='e.g. "1 project" — Enter applies to selection'
          className="w-72 rounded-lg border px-2 py-1 text-sm"
        />
        <button
          onClick={() => void applyToSelection(input)}
          disabled={!selection || saving}
          className="rounded-lg bg-accent px-3 py-1 text-sm font-semibold text-accent-contrast disabled:opacity-40"
        >
          Apply
        </button>
        <button
          onClick={() => void applyToSelection("")}
          disabled={!selection || saving}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40"
        >
          Clear
        </button>
        {saving && <span className="text-xs text-faint">saving…</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} title="Zoom out" className="rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40">
            −
          </button>
          <button onClick={() => setZoom((z) => Math.min(4, z + 1))} disabled={zoom === 4} title="Zoom in" className="rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40">
            +
          </button>
          <button
            onClick={() => setShowLabels((v) => !v)}
            title="Show/hide text in cells (zoom in to read more)"
            className={`rounded-lg border px-2.5 py-1 text-sm ${showLabels ? "bg-accent-soft font-semibold text-accent" : ""}`}
          >
            Aa
          </button>
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {CATEGORIES.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
            {c.code} {c.name}
          </span>
        ))}
      </div>

      {error && <p className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted">Loading month…</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-surface" tabIndex={0} onKeyDown={onKeyDown}>
          <table className="daygrid border-collapse">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="sticky left-0 z-20 bg-surface px-1 py-1">time</th>
                {dates.map((d) => (
                  <th key={d} style={{ minWidth: CELL_W }} className={`px-1 py-1 ${d === todayISO ? "bg-accent-soft" : ""}`}>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
                <tr key={s}>
                  <td className="sticky left-0 z-10 bg-surface px-1 text-right font-mono text-[10px] text-faint">
                    {s % 4 === 0 ? slotToTime(s) : ""}
                  </td>
                  {dates.map((date, d) => {
                    const c = cells.get(key(date, s));
                    const sel = inSelection(d, s);
                    const isFocus = focus?.d === d && focus?.s === s;
                    return (
                      <td
                        key={date}
                        onMouseDown={() => {
                          dragging.current = true;
                          setAnchor({ d, s });
                          setFocus({ d, s });
                          setInput(c ? `${c.category}${c.label ? " " + c.label : ""}` : "");
                        }}
                        onMouseEnter={() => {
                          if (dragging.current) setFocus({ d, s });
                        }}
                        title={c ? `${date} ${slotToTime(s)} — ${c.category}${c.label ? " " + c.label : ""}` : `${date} ${slotToTime(s)}`}
                        className={`cursor-cell overflow-hidden whitespace-nowrap align-middle ${sel ? "ring-2 ring-inset ring-accent" : ""} ${isFocus ? "outline outline-2 outline-accent" : ""}`}
                        style={{
                          height: CELL_H,
                          maxWidth: CELL_W,
                          background: c ? categoryColor(c.category) + (sel ? "" : "cc") : sel ? "var(--accent-soft)" : undefined,
                        }}
                      >
                        {labelsVisible && c ? (
                          <span className="block truncate px-1 text-[10px] font-medium text-white/95" style={{ lineHeight: `${CELL_H}px` }}>
                            {c.label ?? ""}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Drag to select a range (works across days). Type a value like <code>0 Sleep</code> or just <code>1</code>, hit
        Enter. Arrows move, Shift+arrows extend, Delete clears.{" "}
        {focusedCell ? `Selected cell: ${focusedCell.category} ${focusedCell.label ?? ""}` : ""}
      </p>
    </div>
  );
}
