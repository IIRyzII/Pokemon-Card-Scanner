import { useCallback, useEffect, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { hasRole, type CardDetailResponse } from '../../../shared/types.ts';
import { AddToCollection } from '../components/AddToCollection.tsx';
import { CardImage } from '../components/CardImage.tsx';
import { gradeBadge, variantLabel } from '../components/CardTile.tsx';
import { IconBack, IconPlus } from '../components/Icons.tsx';
import { PriceSection } from '../components/PriceSection.tsx';
import { api } from '../lib/api.ts';
import { canonicalArtist } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { goBack, href } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';

/** Any card from the catalog: details, live prices, copies you own, and "Add to collection". */
export function CardPage({ cardId }: { cardId: string }) {
  const { catalog } = useCatalog();
  const { user } = useSession();
  const { reload } = useCollection();
  const { format } = useCurrency();
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const canEdit = hasRole(user?.role, 'editor');
  const fromCatalog = catalog?.byId.get(cardId);

  const load = useCallback(async () => {
    try {
      setDetail(await api.card(cardId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId]);
  useEffect(() => {
    void load();
  }, [load]);

  const card = detail?.card;
  const name = card?.name ?? fromCatalog?.name ?? 'Card';
  const setName = card?.setName ?? fromCatalog?.set.name ?? '';
  const number = card ? cardNumberText(card.number, card.setTotal) : fromCatalog ? cardNumberText(fromCatalog.number, fromCatalog.set.official) : '';
  const artist = canonicalArtist(catalog, card?.artist ?? fromCatalog?.artist);
  const image = card?.image ?? fromCatalog?.image ?? null;
  const owned = detail?.owned ?? [];

  return (
    <div className="page detail">
      <button className="back" onClick={() => goBack('/add')}>
        <IconBack /> Back
      </button>
      <div className="hero">
        <CardImage
          base={image}
          name={name}
          quality="high"
          eager
          className="hero-img"
          setId={card?.setId ?? fromCatalog?.set.id}
          number={card?.number ?? fromCatalog?.number}
        />
        <div className="hero-info">
          <h1>{name}</h1>
          <p className="muted">
            {setName}
            {number && ` · #${number}`}
            {(card?.rarity ?? fromCatalog?.rarity) && ` · ${card?.rarity ?? fromCatalog?.rarity}`}
          </p>
          {artist && (
            <p className="muted">
              🖌 <a href={href('artist', artist)}>{artist}</a>
            </p>
          )}
          {card && (
            <p className="faint small">
              {[card.serieName, card.releaseDate?.slice(0, 4), card.setCode, card.category, card.hp ? `${card.hp} HP` : null]
                .filter(Boolean)
                .join(' · ')}
              <br />
              Printings: {card.variants.map(variantLabel).join(', ')}
            </p>
          )}

          {canEdit && (
            <button className="btn primary big" onClick={() => setAdding(true)} disabled={!card}>
              <IconPlus /> Add to collection
            </button>
          )}

          {owned.length > 0 && (
            <div className="owned-list">
              <h3>In the collection</h3>
              <ul>
                {owned.map((o) => (
                  <li key={o.id}>
                    <a href={href('item', o.id)}>
                      {gradeBadge(o)} · {variantLabel(o.variant)} ×{o.quantity}
                    </a>
                    <span>{format(o.value === null ? null : o.value * o.quantity, o.valueCurrency ?? 'USD')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {detail ? (
        <PriceSection
          detail={detail}
          artist={artist}
          canEdit={canEdit}
          onDetail={setDetail}
          onSalesChanged={() => {
            void load();
            void reload();
          }}
        />
      ) : (
        !error && <div className="spinner" aria-label="Loading prices" />
      )}

      {adding && card && <AddToCollection card={card} detail={detail} onClose={() => setAdding(false)} />}
    </div>
  );
}
