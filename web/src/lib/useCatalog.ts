import { useEffect, useState } from 'react';
import { PRINT_SPEC, PRINT_WORDS } from '../../../shared/cardprint.ts';
import { buildCatalog, type Catalog, type CatalogJson } from './catalog.ts';
import { PrintIndex } from './pictures.ts';

interface Meta {
  hash?: string;
  prints?: { version: number; words: number; hash: string };
}

let metaPromise: Promise<Meta> | null = null;
let promise: Promise<Catalog> | null = null;
let printsPromise: Promise<PrintIndex | null> | null = null;

function loadMeta(): Promise<Meta> {
  metaPromise ??= fetch('./catalog/meta.json', { cache: 'no-cache' })
    .then((r) => r.json() as Promise<Meta>)
    .catch(() => ({})); // offline: fall through to whatever the cache has
  return metaPromise;
}

/** Loads the catalog once per page load (the service worker keeps it offline). */
export function loadCatalog(): Promise<Catalog> {
  promise ??= (async () => {
    const { hash } = await loadMeta();
    const res = await fetch(`./catalog/catalog.json${hash ? `?v=${hash}` : ''}`);
    if (!res.ok) throw new Error('The card catalog is missing. Run "npm run catalog" (or redeploy the site).');
    return buildCatalog((await res.json()) as CatalogJson);
  })().catch((err) => {
    promise = null;
    throw err;
  });
  return promise;
}

/**
 * Every card's picture fingerprint, for recognising cards by how they look. Null when the
 * catalog was built without them (the scanner then reads the card's text only).
 */
export function loadPrintIndex(): Promise<PrintIndex | null> {
  printsPromise ??= (async () => {
    const [meta, catalog] = await Promise.all([loadMeta(), loadCatalog()]);
    const p = meta.prints;
    if (!p || p.version !== PRINT_SPEC.version || p.words !== PRINT_WORDS) return null;
    const res = await fetch(`./catalog/prints.bin?v=${p.hash}`);
    if (!res.ok) return null;
    return new PrintIndex(new Uint32Array(await res.arrayBuffer()), catalog.cards);
  })().catch(() => {
    printsPromise = null;
    return null;
  });
  return printsPromise;
}

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const [state, setState] = useState<{ catalog: Catalog | null; error: string | null }>({ catalog: null, error: null });
  useEffect(() => {
    let alive = true;
    loadCatalog().then(
      (catalog) => alive && setState({ catalog, error: null }),
      (err: Error) => alive && setState({ catalog: null, error: err.message }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
