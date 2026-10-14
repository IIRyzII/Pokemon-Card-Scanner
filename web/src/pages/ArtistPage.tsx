import { useMemo, useState } from 'react';
import { artOfPkmArtistUrl } from '../../../shared/links.ts';
import { CatalogTile } from '../components/CardTile.tsx';
import { IconBack, IconExternal } from '../components/Icons.tsx';
import { artistKey } from '../lib/catalog.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { money } from '../lib/format.ts';
import { goBack } from '../lib/router.ts';
import { useCatalog } from '../lib/useCatalog.ts';

export function ArtistPage({ name }: { name: string }) {
  const { catalog, error } = useCatalog();
  const { ownedByCard, data } = useCollection();
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [order, setOrder] = useState<'new' | 'old'>('new');
  const artist = catalog?.artistByKey.get(artistKey(name));

  const cards = useMemo(() => {
    if (!artist) return [];
    const list = artist.cards.filter((c) => !onlyOwned || ownedByCard.has(c.id));
    return list.sort((a, b) => {
      const d = (a.set.date ?? '').localeCompare(b.set.date ?? '') || a.order - b.order;
      return order === 'new' ? -d : d;
    });
  }, [artist, onlyOwned, order, ownedByCard]);

  const ownedValue = useMemo(() => {
    const key = artistKey(name);
    return (data?.items ?? [])
      .filter((i) => i.artist && artistKey(i.artist) === key)
      .reduce((sum, i) => sum + (i.value ?? 0) * i.quantity, 0);
  }, [data, name]);
  const ownedCards = artist ? artist.cards.filter((c) => ownedByCard.has(c.id)).length : 0;

  return (
    <div className="page">
      <button className="back" onClick={() => goBack('/artists')}>
        <IconBack /> Artists
      </button>
      <h1>🖌 {artist?.name ?? name}</h1>
      {error && <p className="error">{error}</p>}
      {catalog && !artist && <p className="muted">No cards by this artist are in the catalog.</p>}
      {artist && (
        <>
          <p className="muted">
            {artist.cards.length} cards illustrated · you own {ownedCards}
            {ownedValue > 0 && ` (worth ${money(ownedValue)})`}
          </p>
          <div className="link-row">
            <a className="chip" href={artOfPkmArtistUrl(artist.name)} target="_blank" rel="noreferrer">
              Art of Pokémon <IconExternal />
            </a>
          </div>
          <div className="toolbar">
            <div className="segmented small">
              <button className={!onlyOwned ? 'on' : ''} onClick={() => setOnlyOwned(false)}>
                All cards
              </button>
              <button className={onlyOwned ? 'on' : ''} onClick={() => setOnlyOwned(true)}>
                Owned
              </button>
            </div>
            <select value={order} onChange={(e) => setOrder(e.target.value as 'new' | 'old')} aria-label="Order">
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </div>
          <div className="grid">
            {cards.map((c) => (
              <CatalogTile key={c.id} card={c} owned={ownedCount(ownedByCard.get(c.id))} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
