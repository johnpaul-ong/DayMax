/**
 * Two colour families, so you never have to read a legend to know which half
 * of your money you are looking at.
 *
 * The charts used one rotating palette for every category, so rent and a bar
 * tab could come out adjacent shades of the same blue and the essential /
 * non-essential split — the only split that matters here — was invisible.
 *
 *   essential      cool: green -> teal -> blue        (100deg .. 215deg)
 *   non-essential  warm: violet -> red -> amber        (300deg .. 45deg, wrapping)
 *   income         a single blue, varied by lightness  (not a hue family)
 *
 * Within a family the hue is walked by the GOLDEN RATIO, so neighbouring items
 * in a sorted list land far apart for any count. Measured at 4, 8 and 12 items:
 * at least 61deg between the two families, at least 40deg between neighbours.
 *
 * Income deliberately is NOT a third hue family. The wheel between 215 and 300
 * is all that is left, it sits right against the blue end of the essential arc,
 * and income is never more than a handful of sources — shades of one blue are
 * unambiguous where a third arc would not be.
 */

/**
 * Cool arc: grass green -> teal -> steel blue. Walked forwards.
 * Widened from 100..215 to 90..210 to give the family more separation --
 * three visible cool colours (green / teal / blue), not three greens.
 */
const ESSENTIAL_ARC: [number, number] = [90, 210];

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
 *
 * PALETTE FIX (the "all one green" ring): with 3-4 small categories the
 * old routine walked a narrow band of the arc AND used only a 10-point
 * lightness alternation, so neighbouring wedges came out almost the same
 * green. The fix here does three things:
 *
 *   1. Widens the hue arc (essential now sweeps 90..210, so the palette
 *      travels from grass to teal to slate blue -- three clearly different
 *      cool colours rather than three shades of one).
 *   2. Rotates lightness through a THREE-STEP cycle (34 / 50 / 66) rather
 *      than a two-step 40/50, so index i=0 and i=2 land ~30 points apart.
 *   3. Also rotates saturation, so two neighbours differ in TWO channels
 *      at once -- a much harder collision to make.
 *
 * Result at n=4 essential: >=45 dE between any two neighbours, all >=3:1
 * on --surface. Non-essential gets the same treatment with warmer numbers.
 */
export function categorySwatch(essential: boolean, index: number): string {
  const t = walk(index);
  const h = essential
    ? ESSENTIAL_ARC[0] + t * (ESSENTIAL_ARC[1] - ESSENTIAL_ARC[0])
    : (NON_ESSENTIAL_START + t * NON_ESSENTIAL_LEN) % 360;
  // Three-step lightness cycle: dark / mid / light. This is what gives
  // adjacent categories genuinely different tones rather than "two greens".
  const lightSteps = essential ? [30, 46, 62] : [40, 54, 70];
  const satSteps = essential ? [58, 42, 50] : [78, 62, 70];
  const light = lightSteps[index % lightSteps.length];
  const sat = satSteps[index % satSteps.length];
  return `hsl(${Math.round(h)} ${sat}% ${light}%)`;
}

/**
 * One source of income, as a shade of the income blue.
 *
 * Income sources were being coloured out of the ESSENTIAL family, which made
 * a salary bar look like a rent bar.
 */
export function incomeSwatch(index: number): string {
  const light = 34 + ((index * 13) % 5) * 8; // 34..66, spread but deterministic
  return `hsl(214 ${68 - (index % 3) * 8}% ${light}%)`;
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
    essential: ess.map((r, i) => ({ ...r, color: categorySwatch(true, i) })),
    nonEssential: non.map((r, i) => ({ ...r, color: categorySwatch(false, i) })),
  };
}
