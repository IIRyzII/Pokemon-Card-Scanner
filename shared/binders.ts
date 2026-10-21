// Binders: limits shared by the API (which stores binders) and the app (which draws them).

/** Pockets per page, and how many across: 2×2, 3×3 and 3×4 pages. */
export const POCKET_LAYOUTS = { 4: 2, 9: 3, 12: 3 } as const;
export type Pockets = keyof typeof POCKET_LAYOUTS;
export const POCKET_SIZES = Object.keys(POCKET_LAYOUTS).map(Number) as Pockets[];

/** Most copies of one card in a row (two full 9-pocket pages and then some). */
export const MAX_COPIES = 99;
/** Most pockets in one binder (the biggest real binders hold well under this). */
export const MAX_POCKETS = 5000;

/** Binder colours, as on the shelf. */
export const BINDER_COLOURS = {
  red: { label: 'Red', hex: '#c8413b' },
  orange: { label: 'Orange', hex: '#e07b2e' },
  yellow: { label: 'Yellow', hex: '#e2b52c' },
  green: { label: 'Green', hex: '#3d8f55' },
  teal: { label: 'Teal', hex: '#23918f' },
  blue: { label: 'Blue', hex: '#3567c9' },
  navy: { label: 'Navy', hex: '#28365e' },
  purple: { label: 'Purple', hex: '#7449b8' },
  pink: { label: 'Pink', hex: '#d75f97' },
  brown: { label: 'Brown', hex: '#7f5236' },
  black: { label: 'Black', hex: '#26262b' },
  white: { label: 'White', hex: '#e6e1d6' },
} as const;
export type BinderColour = keyof typeof BINDER_COLOURS;
export const BINDER_COLOUR_KEYS = Object.keys(BINDER_COLOURS) as BinderColour[];

/** A binder's colour: the one chosen, or one picked from its id so it stays the same. */
export function colourOf(binder: { id: string; colour?: string | null }): BinderColour {
  if (binder.colour && binder.colour in BINDER_COLOURS) return binder.colour as BinderColour;
  let hash = 0;
  for (const ch of binder.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BINDER_COLOUR_KEYS[hash % BINDER_COLOUR_KEYS.length];
}

/** A colour for a new binder: the first not on the shelf yet. */
export function nextColour(shelf: { id: string; colour?: string | null }[]): BinderColour {
  const used = new Set(shelf.map(colourOf));
  return BINDER_COLOUR_KEYS.find((c) => !used.has(c)) ?? BINDER_COLOUR_KEYS[shelf.length % BINDER_COLOUR_KEYS.length];
}
