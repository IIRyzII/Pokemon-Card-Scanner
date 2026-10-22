import { useMemo, useState } from 'react';
import { IconSearch } from '../components/Icons.tsx';
import { artistKey, normName } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { href } from '../lib/router.ts';
import { useCatalog } from '../lib/useCatalog.ts';
import { SetsArtistsSwitch } from './SetsPage.tsx';

type Sort = 'owned' | 'cards' | 'name';

/** Every illustrator in the catalog, with how many of their cards you own. */
export function ArtistsPage() {
  const { catalog, error } = useCatalog();
  const { data } = useCollection();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('owned');

  // Owned copies per artist key, from the collection's own artist field.
  const owned = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data?.items ?? []) {
      if (!item.artist) continue;
      const k = artistKey(item.artist);
      map.set(k, (map.get(k) ?? 0) + item.quantity);
    }
    return map;
  }, [data]);

  const list = useMemo(() => {
    if (!catalog) return [];
    const q = normName(query);
    return catalog.artists
      .filter((a) => !q || normName(a.name).includes(q))
      .map((a) => ({ ...a, owned: owned.get(a.key) ?? 0 }))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : sort === 'cards'
            ? b.cards.length - a.cards.length || a.name.localeCompare(b.name)
            : b.owned - a.owned || b.cards.length - a.cards.length,
      );
  }, [catalog, query, sort, owned]);

  return (
    <div className="page">
      <SetsArtistsSwitch at="artists" />
      <h1>Artists</h1>
      <p className="muted small">
        The illustrators behind every card. Tap one to see all of their cards and which ones you have.
      </p>
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input type="search" placeholder="Find an artist…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort artists">
          <option value="owned">Most owned</option>
          <option value="cards">Most cards</option>
          <option value="name">A–Z</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {!catalog && !error && <div className="spinner" />}
      <ul className="artist-list">
        {list.map((a) => (
          <li key={a.key}>
            <a href={href('artist', a.name)}>
              <span className="artist-name">{a.name}</span>
              <span className="faint small">{a.cards.length} cards</span>
              {a.owned > 0 && <span className="badge owned-badge">{a.owned} owned</span>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
