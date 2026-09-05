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

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      setError(`Cannot parse "${trimmed}". Use "<category number> <optional label>", e.g. "1 thesis".`);
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

  async function copyYesterday() {
    if (!focus) return;
    const date = dates[focus.d];
    const prev = addDays(date, -1);
    setSaving(true);
    try {
      const prevEntries =
        prev.slice(0, 7) === ym
          ? Array.from({ length: SLOTS_PER_DAY }, (_, s) => {
              const c = cells.get(key(prev, s));
              return c ? { date, slot: s, category: c.category, label: c.label } : null;
            }).filter((x): x is DayEntry => x !== null)
          : (await fetchDayEntries(prev, prev)).map((e) => ({ ...e, date }));
      const next = new Map(cells);
      for (const e of prevEntries) next.set(key(date, e.slot), { category: e.category, label: e.label });
      setCells(next);
      await upsertDayEntries(prevEntries);
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
        <h1 className="mr-2 text-xl font-bold">Day grid</h1>
        <input
          type="month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
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
          placeholder='e.g. "1 thesis" — Enter applies to selection'
          className="w-72 rounded-md border px-2 py-1 text-sm"
        />
        <button
          onClick={() => void applyToSelection(input)}
          disabled={!selection || saving}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-40"
        >
          Apply
        </button>
        <button
          onClick={() => void applyToSelection("")}
          disabled={!selection || saving}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-40"
        >
          Clear
        </button>
        <button
          onClick={() => void copyYesterday()}
          disabled={!focus || saving}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-40"
        >
          Copy yesterday → selected day
        </button>
        {saving && <span className="text-xs text-slate-400">saving…</span>}
      </div>

      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {CATEGORIES.map((c) => (
          <span key={c.code} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
            {c.code} {c.name}
          </span>
        ))}
      </div>

      {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading month…</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-white" tabIndex={0} onKeyDown={onKeyDown}>
          <table className="daygrid border-collapse">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <th className="sticky left-0 z-20 bg-white px-1 py-1">time</th>
                {dates.map((d, i) => (
                  <th key={d} className={`min-w-[52px] px-1 py-1 ${d === todayISO ? "bg-blue-50" : ""}`}>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
                <tr key={s}>
                  <td className="sticky left-0 z-10 bg-white px-1 text-right font-mono text-[10px] text-slate-400">
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
                        className={`h-[14px] cursor-cell ${sel ? "ring-2 ring-inset ring-blue-500" : ""} ${isFocus ? "outline outline-2 outline-blue-700" : ""}`}
                        style={{ background: c ? categoryColor(c.category) + (sel ? "" : "cc") : sel ? "#dbeafe" : undefined }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Drag to select a range (works across days). Type a value like <code>0 Sleep</code> or just <code>1</code>, hit
        Enter. Arrows move, Shift+arrows extend, Delete clears.{" "}
        {focusedCell ? `Selected cell: ${focusedCell.category} ${focusedCell.label ?? ""}` : ""}
      </p>
    </div>
  );
}
