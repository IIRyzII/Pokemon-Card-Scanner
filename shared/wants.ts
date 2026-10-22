// The want list: limits shared by the API (which stores hand-picked wants) and the app.

/** How much a card is wanted: 1 must have, 2 want, 3 someday. */
export const WANT_PRIORITIES = { 1: 'Must have', 2: 'Want', 3: 'Someday' } as const;
export type WantPriority = keyof typeof WANT_PRIORITIES;
export const PRIORITY_VALUES = [1, 2, 3] as const;
export const DEFAULT_PRIORITY: WantPriority = 2;

export const isPriority = (v: unknown): v is WantPriority => v === 1 || v === 2 || v === 3;

/** Most copies of one card wanted (like a binder row: two full 9-pocket pages and then some). */
export const MAX_WANT_QUANTITY = 99;
