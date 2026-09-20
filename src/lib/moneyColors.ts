/**
 * Two colour families, so you never have to read a legend to know which half
 * of your money you are looking at.
 *
 * The charts used one rotating palette for every category, so rent and a bar
 * tab could come out adjacent shades of the same blue and the essential /
 * non-essential split — the only split that matters here — was invisible.
 *
 *   essential      cool: greens through teals into blue
 *   non-essential  warm: amber through red into pink and violet
 *
 * Within a family, hue is walked in large steps rather than sequentially, so
 * neighbouring items in a sorted list land far apart on the wheel and stay
 * distinguishable even when there are a dozen of them.
 */

/**
 * Cool arc: green -> teal -> blue. Walked forwards.
 */
const ESSENTIAL_ARC: [number, number] = [100, 215];

/**
 * Warm arc: violet -> pink -> red -> orange -> amber. Crosses 360, so it is
 * expressed as a start plus a length and wrapped at the end.
 *
 * The first version wrote this as [36, 330] and walked it forwards, which goes
 * the LONG way round through green and blue — the two families overlapped to
 * within 1 degree and the whole point was lost.
 */
const NON_ESSENTIAL_START = 300;
const NON_ESSENTIAL_LEN = 105;

/**
 * Golden-ratio stepping. Successive indexes land far apart for ANY count,
 * with no collisions and no need to know n in advance — modular stepping only
 * behaves for counts coprime with the step, which is not something a category
 * list guarantees.
 */
const PHI = 0.6180339887;

function walk(i: number): number {
  return (i * PHI) % 1;
}

/**
 * A stable colour for one category.
 *
 * `index` is that category's position within its OWN group. Passing a position
 * from a mixed list would hand the two groups the same hue.
 */
export function categorySwatch(essential: boolean, index: number, _count = 0): string {
  const t = walk(index);
  const h = essential
    ? ESSENTIAL_ARC[0] + t * (ESSENTIAL_ARC[1] - ESSENTIAL_ARC[0])
    : (NON_ESSENTIAL_START + t * NON_ESSENTIAL_LEN) % 360;
  // Non-essential runs hotter and lighter so it reads as the louder half even
  // at a glance; alternating lightness separates any two that land close.
  const sat = essential ? 44 : 70;
  const light = (essential ? 40 : 50) + (index % 2 === 0 ? 0 : 10);
  return `hsl(${Math.round(h)} ${sat}% ${light}%)`;
}

/** The two group colours themselves, for totals, bars and legends. */
export const GROUP_COLOR = {
  essential: "hsl(152 48% 38%)",
  nonEssential: "hsl(4 72% 54%)",
  income: "hsl(214 70% 52%)",
  saved: "hsl(178 52% 40%)",
} as const;

export interface Grouped<T> {
  essential: T[];
  nonEssential: T[];
}

/**
 * Split a list of categories in two and hand each item a colour from its own
 * family. Sorting happens inside, so callers cannot accidentally colour by a
 * mixed-list index.
 */
export function splitAndColour<T extends { essential: boolean; total: number }>(
  rows: T[]
): Grouped<T & { color: string }> {
  const ess = rows.filter((r) => r.essential).sort((a, b) => b.total - a.total);
  const non = rows.filter((r) => !r.essential).sort((a, b) => b.total - a.total);
  return {
    essential: ess.map((r, i) => ({ ...r, color: categorySwatch(true, i, ess.length) })),
    nonEssential: non.map((r, i) => ({ ...r, color: categorySwatch(false, i, non.length) })),
  };
}
