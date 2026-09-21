"use client";

/**
 * Category legend, grouped by BUCKET. What each coloured stripe /
 * wedge / column across the app actually is, in the same per-theme
 * colour every chart uses. The three-row grouping (Productive /
 * Brainrot / Other) does the "why does this count in the score"
 * work without per-chip tags.
 *
 * Shared between the challenge pages and the /today logging page --
 * anywhere a user needs to know what a colour means. Renders as a
 * .card row that sits inline with the page's other cards.
 */

import { CATEGORIES, categoryColor, defaultBuckets, type Bucket } from "@/lib/categories";

export default function CategoryLegend() {
  const buckets = defaultBuckets();
  const grouped: Record<Bucket, typeof CATEGORIES> = {
    productive: [],
    brainrot: [],
    other: [],
  };
  for (const c of CATEGORIES) grouped[buckets[c.code]].push(c);

  const rows: Array<{ key: Bucket; label: string; tone: string }> = [
    { key: "productive", label: "Productive", tone: "text-ok" },
    { key: "brainrot", label: "Brainrot", tone: "text-danger" },
    { key: "other", label: "Other", tone: "text-faint" },
  ];

  const Chip = ({ code, name }: { code: number; name: string }) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: categoryColor(code) }}
      />
      <span className="text-xs font-medium">{name}</span>
    </span>
  );

  return (
    <div className="card px-3 py-2">
      <div className="grid gap-y-1.5">
        {rows.map((row) => {
          const cats = grouped[row.key];
          if (cats.length === 0) return null;
          return (
            <div key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider ${row.tone}`}
              >
                {row.label}
              </span>
              {cats.map((c) => (
                <Chip key={c.code} code={c.code} name={c.name} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
