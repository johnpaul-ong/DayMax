/**
 * One source of chart series colours, for every chart in the app.
 *
 * Every page used to carry its own copy of the same hardcoded array:
 *
 *   const SERIES = ["#4f6ef7", "#16a34a", "#dc2626", "#f59e0b", …]
 *
 * which is the LIGHT theme's indigo and a set of Tailwind mid-tones. That was
 * fine while light was the only theme. It is not fine now: under iOS the UI is
 * systemBlue and every chart came out a different, slightly-off blue, so the
 * app looked like two products stitched together. On dark, half the palette sat
 * at ~2:1 against the card and read as mud.
 *
 * Colours therefore live in CSS, next to the theme that owns them
 * (`--chart-1` … `--chart-9` and `--chart-muted`, defined per theme in
 * globals.css), and are referenced from here.
 *
 * WHY var() AND NOT A RESOLVED HEX
 * --------------------------------
 * `chartSeries(i)` returns a `var(--chart-N, #fallback)` string rather than a
 * concrete colour. recharts passes `stroke` / `fill` straight through to the
 * SVG presentation attribute, and a presentation attribute is CSS, so the
 * browser resolves the variable itself. The repo already relies on this —
 * `stroke="var(--border)"`, `fill="var(--accent)"` and
 * `fill="var(--surface-2)"` have been working in these charts all along. It is
 * also the only approach that repaints instantly when the theme changes, with
 * no re-render and no effect wired to the theme.
 *
 * The baked-in fallback is the light theme's value, so the first server-rendered
 * paint is correct even before any stylesheet has matched.
 *
 * WHEN YOU NEED A REAL COLOUR
 * ---------------------------
 * Canvas (`ctx.fillStyle`), anything measuring or blending a colour, or any API
 * that parses the string itself cannot take a `var()`. Use `resolveChartSeries()`
 * / `resolveCssVar()` for those. They must run on the client — `getComputedStyle`
 * does not exist on the server — so they fall back to the static palette instead
 * of throwing when `document` is missing. (See share-card.tsx for the same
 * pattern applied to --page / --ink / --muted.)
 *
 * NOT IN SCOPE: the day-grid category colours (`@/lib/categories`), the ranking
 * bucket colours (`DEFAULT_BUCKET_COLORS` in `@/lib/theme`, user-customisable)
 * and the money families (`@/lib/moneyColors`) are deliberately theme
 * independent and are not routed through here.
 */

/** Series slots, in walk order. Nine, because the Overview trends graph can
 *  plot nine metrics at once and an eighth-plus-wrap would repeat a colour. */
export const CHART_SERIES_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
  "--chart-9",
] as const;

export const CHART_SERIES_COUNT = CHART_SERIES_VARS.length;

/** The neutral "everything else" series. */
export const CHART_MUTED_VAR = "--chart-muted";

/**
 * Static fallback, used for SSR and as the in-var() default. These are the
 * light theme's values and must stay in step with the `:root` block of
 * globals.css — they are what you see if no stylesheet has applied yet.
 */
export const CHART_SERIES_FALLBACK: readonly string[] = [
  "#4f6ef7",
  "#15803d",
  "#dc2626",
  "#b45309",
  "#0284c7",
  "#7c3aed",
  "#be185d",
  "#0f766e",
  "#78716c",
];

export const CHART_MUTED_FALLBACK = "#8a94a6";

/** Positive modulo, so a negative index still lands in the palette. */
function slot(i: number): number {
  return ((i % CHART_SERIES_COUNT) + CHART_SERIES_COUNT) % CHART_SERIES_COUNT;
}

/**
 * The colour for series `i`, as a CSS reference. Wraps, so callers can pass a
 * raw array index without doing their own `% length`.
 *
 * Safe for any recharts `stroke` / `fill` prop and for any React `style` value.
 */
export function chartSeries(i: number): string {
  const n = slot(i);
  return `var(${CHART_SERIES_VARS[n]}, ${CHART_SERIES_FALLBACK[n]})`;
}

/** Same thing for the full palette, when you want to map over it directly. */
export const CHART_SERIES: readonly string[] = CHART_SERIES_VARS.map((_, i) => chartSeries(i));

/** The neutral series — "other", "unclassified", the leftovers bar. */
export const CHART_MUTED = `var(${CHART_MUTED_VAR}, ${CHART_MUTED_FALLBACK})`;

/**
 * Semantic chart colours. These already exist as theme tokens; they are
 * re-exported here so a chart never has to reach for a raw hex again.
 * Use them when a series *means* good / bad / warning, not merely "the
 * second one".
 */
export const CHART_OK = "var(--ok)";
export const CHART_DANGER = "var(--danger)";
export const CHART_WARN = "var(--warn)";
export const CHART_ACCENT = "var(--accent)";

/**
 * Read a custom property off the document root and return a concrete colour.
 *
 * Returns `fallback` unchanged when there is no DOM (server render, or a test
 * environment without jsdom) rather than throwing on `getComputedStyle`.
 */
export function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** The whole series palette as concrete colours, for canvas and friends. */
export function resolveChartSeries(): string[] {
  return CHART_SERIES_VARS.map((v, i) => resolveCssVar(v, CHART_SERIES_FALLBACK[i]));
}

/** One series colour as a concrete colour. Wraps, like `chartSeries`. */
export function resolveChartSeriesColor(i: number): string {
  const n = slot(i);
  return resolveCssVar(CHART_SERIES_VARS[n], CHART_SERIES_FALLBACK[n]);
}

/** The neutral series as a concrete colour. */
export function resolveChartMuted(): string {
  return resolveCssVar(CHART_MUTED_VAR, CHART_MUTED_FALLBACK);
}
