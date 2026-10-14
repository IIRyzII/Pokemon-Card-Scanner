import { useEffect, useState } from 'react';
import { buildCatalog, type Catalog, type CatalogJson } from './catalog.ts';

let promise: Promise<Catalog> | null = null;

/** Loads the catalog once per page load (the service worker keeps it offline). */
export function loadCatalog(): Promise<Catalog> {
  promise ??= (async () => {
    let hash = '';
    try {
      const meta = (await (await fetch('./catalog/meta.json', { cache: 'no-cache' })).json()) as { hash?: string };
      hash = meta.hash ?? '';
    } catch {
      // offline: fall through to whatever catalog.json the cache has
    }
    const res = await fetch(`./catalog/catalog.json${hash ? `?v=${hash}` : ''}`);
    if (!res.ok) throw new Error('The card catalog is missing. Run "npm run catalog" (or redeploy the site).');
    return buildCatalog((await res.json()) as CatalogJson);
  })().catch((err) => {
    promise = null;
    throw err;
  });
  return promise;
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
