// Which printings a card comes in, worked out from its rarity, for the sets TCGdex has no printing
// data for (it marks every card in them "normal": most Black & White, XY and Sun & Moon sets).
// Those eras follow one pattern: commons, uncommons and rares come as a regular card and a
// reverse holo, holo rares as a holo and a reverse holo, and EX / GX / BREAK / full art / secret
// cards only as holos.

import type { Variant } from './grading.ts';

/** Sets without reverse holos: promos, starter and special sets sold outside booster packs. */
const NO_REVERSE = /^(bwp|xyp|smp|xy0|xya|g1|dc1|dv1|det1|sma|ru1|mfb|ex5\.5|tk-|mcd)/;

/** Cards that are only ever holos (the "special" rarities, or EX / GX / BREAK / LV.X / Prism Star names). */
const HOLO_ONLY =
  /ultra|secret|rainbow|prism|break|shiny|amazing|radiant|legend|lv\.?x|prime|ace|star|holo (ex|gx|v|vmax|vstar)\b|full art/;
const HOLO_NAME = /(?:[ -](?:ex|gx|break|lv\.x))$|◇|☆/i;

export interface PrintingInput {
  setId: string;
  name: string;
  /** Its rarity as pokemon-tcg-data (or TCGdex) gives it: "Rare Holo", "Rare Holo GX", "Common"… */
  rarity: string | null;
}

/**
 * A printing the card doesn't come in (recorded before its printings were known, e.g. a Shuckle-GX
 * saved as "normal") taken as its main printing; anything else as it is.
 */
export function fixPrinting(variant: string, known: readonly string[] | null | undefined): string {
  return known?.length && !known.includes(variant) ? known[0] : variant;
}

/** The printings to offer when adding a card: the catalog's (best guess first), then any others the API allows. */
export function preferPrintings(allowed: readonly string[], preferred: readonly string[] | null | undefined): string[] {
  const first = (preferred ?? []).filter((v) => allowed.includes(v));
  return [...first, ...allowed.filter((v) => !first.includes(v))];
}

export function inferPrintings({ setId, name, rarity }: PrintingInput): Variant[] {
  const r = (rarity ?? '').toLowerCase().trim();
  const holoOnly = HOLO_ONLY.test(r) || HOLO_NAME.test(name.trim());
  const main: Variant = holoOnly || /holo/.test(r) ? 'holo' : 'normal';
  const reverse = !holoOnly && !NO_REVERSE.test(setId) && /^(common|uncommon|rare|rare holo|holo rare)$/.test(r);
  return reverse ? [main, 'reverse'] : [main];
}
