// Binders: limits shared by the API (which stores binders) and the app (which draws them).

/** Pockets per page, and how many across: 2×2, 3×3 and 3×4 pages. */
export const POCKET_LAYOUTS = { 4: 2, 9: 3, 12: 3 } as const;
export type Pockets = keyof typeof POCKET_LAYOUTS;
export const POCKET_SIZES = Object.keys(POCKET_LAYOUTS).map(Number) as Pockets[];

/** Most copies of one card in a row (two full 9-pocket pages and then some). */
export const MAX_COPIES = 99;
/** Most pockets in one binder (the biggest real binders hold well under this). */
export const MAX_POCKETS = 5000;
