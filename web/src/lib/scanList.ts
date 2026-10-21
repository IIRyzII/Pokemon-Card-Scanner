// The scan list: cards scanned one after another, then added to the collection together. It's
// kept on this device (leaving the page or closing the app doesn't lose it) until they're added.

import { useSyncExternalStore } from 'react';
import type { ItemFields } from '../../../shared/types.ts';
import type { CatalogCard } from './catalog.ts';

/** What the list shows of a card (a copy, so it doesn't need the catalog). */
export interface ListCard {
  id: string;
  name: string;
  setId: string;
  setName: string;
  number: string;
  /** Printed set size, for "#025/165" */
  setTotal: number | null;
  image: string | null;
}

export interface ListEntry {
  /** Unique within the list */
  key: string;
  card: ListCard;
  fields: ItemFields;
  /** Printings the card comes in, once the API has said (the catalog doesn't know) */
  variants: string[] | null;
  /** Why adding it failed last time */
  error?: string;
}

/** The last card put in the list, so it can be taken out again straight away. */
export interface LastAdded {
  key: string;
  name: string;
  /** It was another copy of a card already in the list (the count went up) */
  more: boolean;
}

/** Adds a card. Another copy of a card already in the list counts that entry up instead. */
export function addCard(list: ListEntry[], card: ListCard, fields: ItemFields, key: string): { list: ListEntry[]; entry: ListEntry; more: boolean } {
  const same = list.find((e) => e.card.id === card.id);
  if (same) {
    const entry = { ...same, fields: { ...same.fields, quantity: Math.min(999, same.fields.quantity + 1) }, error: undefined };
    return { list: list.map((e) => (e === same ? entry : e)), entry, more: true };
  }
  const entry: ListEntry = { key, card, fields, variants: null };
  return { list: [entry, ...list], entry, more: false };
}

/** Undoes addCard: counts the entry back down, or takes it out if it was new. */
export function takeBack(list: ListEntry[], key: string, more: boolean): ListEntry[] {
  if (!more) return list.filter((e) => e.key !== key);
  return list.map((e) => (e.key === key ? { ...e, fields: { ...e.fields, quantity: Math.max(1, e.fields.quantity - 1) } } : e));
}

/**
 * Records which printings a card comes in. The first time, entries start on the first printing
 * (as adding a single card does); after that they only move off one the card doesn't have.
 */
export function withVariants(list: ListEntry[], cardId: string, variants: string[]): ListEntry[] {
  return list.map((e) => {
    if (e.card.id !== cardId) return e;
    const keep = !variants.length || (e.variants !== null && variants.includes(e.fields.variant));
    return { ...e, variants, fields: keep ? e.fields : { ...e.fields, variant: variants[0] } };
  });
}

/** The parts of a catalog card the list keeps. */
export const listCardOf = (card: CatalogCard): ListCard => ({
  id: card.id,
  name: card.name,
  setId: card.set.id,
  setName: card.set.name,
  number: card.number,
  setTotal: card.set.official,
  image: card.image,
});

/** Total copies in the list. */
export const copiesIn = (list: ListEntry[]) => list.reduce((n, e) => n + e.fields.quantity, 0);

const KEY = 'pokevault.scanList';

function load(): ListEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? (saved as ListEntry[]).filter((e) => e?.card?.id && e.fields) : [];
  } catch {
    return [];
  }
}

let entries: ListEntry[] = load();
let lastAdded: LastAdded | null = null;
const listeners = new Set<() => void>();

function set(next: ListEntry[]) {
  entries = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode etc. — the list just won't survive a reload
  }
  listeners.forEach((fn) => fn());
}

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const scanList = {
  get: () => entries,
  lastAdded: () => lastAdded,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  add(card: ListCard, fields: ItemFields): ListEntry {
    const r = addCard(entries, card, fields, newKey());
    lastAdded = { key: r.entry.key, name: card.name, more: r.more };
    set(r.list);
    return r.entry;
  },
  undo() {
    if (!lastAdded) return;
    const { key, more } = lastAdded;
    lastAdded = null;
    set(takeBack(entries, key, more));
  },
  setVariants(cardId: string, variants: string[]) {
    set(withVariants(entries, cardId, variants));
  },
  update(key: string, patch: Partial<Omit<ListEntry, 'key' | 'card'>>) {
    set(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  },
  remove(key: string) {
    if (lastAdded?.key === key) lastAdded = null;
    set(entries.filter((e) => e.key !== key));
  },
  clear() {
    lastAdded = null;
    set([]);
  },
};

export function useScanList(): ListEntry[] {
  return useSyncExternalStore(scanList.subscribe, scanList.get, scanList.get);
}

export function useLastAdded(): LastAdded | null {
  return useSyncExternalStore(scanList.subscribe, scanList.lastAdded, scanList.lastAdded);
}

const STACK_KEY = 'pokevault.scanStack';

/** The scanner is set to scan a stack of cards into the list (remembered on this device). */
export function stackMode(): boolean {
  try {
    return localStorage.getItem(STACK_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setStackMode(on: boolean) {
  try {
    localStorage.setItem(STACK_KEY, on ? 'on' : 'off');
  } catch {
    // ignore
  }
}
