import { useMemo, useState } from 'react';
import { CatalogTile } from '../components/CardTile.tsx';
import { IconBack } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import type { CatalogCard } from '../lib/catalog.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { shortDate } from '../lib/format.ts';
import { goBack } from '../lib/router.ts';
import { percentText, priceLookup, setLogoUrl, setValue } from '../lib/sets.ts';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';

type Show = 'all' | 'owned' | 'missing';
type Order = 'number' | 'priceHigh' | 'priceLow';

/** One set laid out like a binder: every card in number order, the ones you don't have greyed out. */
export function SetPage({ id }: { id: string }) {
  const { catalog, error } = useCatalog();
  const { ownedByCard, data } = useCollection();
  const prices = useMarketPrices();
  const { convert, format, currency } = useCurrency();
  const [show, setShow] = useState<Show>('all');
  const [order, setOrder] = useState<Order>('number');
  const set = catalog?.sets.find((s) => s.id === id);
  const cards = useMemo(() => catalog?.bySet.get(id) ?? [], [catalog, id]);
  const priceOf = useMemo(() => priceLookup(prices, convert), [prices, convert]);
  const has = (c: CatalogCard) => ownedByCard.has(c.id);
  const owned = cards.filter(has).length;
  const missing = cards.length - owned;
  const value = prices ? setValue({ cards }, priceOf, has) : null;

  const shown = useMemo(() => {
    const list = cards.filter((c) => show === 'all' || (show === 'owned') === ownedByCard.has(c.id));
    if (order === 'number') return list;
    // Cards without a price go last either way.
    const p = (c: CatalogCard) => priceOf(c) ?? (order === 'priceHigh' ? -Infinity : Infinity);
    return [...list].sort((a, b) => (order === 'priceHigh' ? p(b) - p(a) : p(a) - p(b)));
  }, [cards, show, order, ownedByCard, priceOf]);

  // Your own copies, valued like the rest of the collection (printing, condition, grade, quantity).
  const yourCopies = useMemo(() => {
    const ids = new Set(cards.map((c) => c.id));
    return (data?.items ?? [])
      .filter((i) => ids.has(i.cardId))
      .reduce((sum, i) => sum + (convert(i.value, i.valueCurrency ?? 'USD') ?? 0) * i.quantity, 0);
  }, [data, cards, convert]);
  const secret = set?.official && cards.length > set.official ? cards.length - set.official : 0;
  const logo = set ? setLogoUrl(set) : null;
  const money = (v: number) => format(v, currency, { round: true });

  return (
    <div className="page">
      <button className="back" onClick={() => goBack('/sets')}>
        <IconBack /> Sets
      </button>
      {error && <p className="error">{error}</p>}
      {!catalog && !error && <div className="spinner" aria-label="Loading set" />}
      {catalog && !set && <p className="muted">This set isn't in the catalog.</p>}
      {set && (
        <>
          <header className="set-head">
            {logo && <img className="set-head-logo" src={logo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
            <h1>{set.name}</h1>
            <p className="muted">{[set.serieName, set.date && `released ${shortDate(set.date)}`, set.code].filter(Boolean).join(' · ')}</p>
          </header>
          <section className="value-box">
            <div className="set-progress-line">
              <span>
                You have <b>{owned}</b> of {cards.length} cards
                {secret > 0 && (
                  <span className="faint small">
                    {' '}
                    ({set.official} numbered + {secret} secret)
                  </span>
                )}
              </span>
              <b>{percentText({ owned, cards })}</b>
            </div>
            <ProgressBar value={owned} max={cards.length} label={`${set.name} completion`} />
            <p className="faint small">{missing === 0 ? 'Complete! 🎉' : `${missing} to go.`}</p>
            {value && value.priced > 0 && (
              <dl className="set-values">
                <div>
                  <dt>Set value</dt>
                  <dd>{money(value.total)}</dd>
                </div>
                <div>
                  <dt>Cards you have</dt>
                  <dd>{money(value.owned)}</dd>
                </div>
                <div>
                  <dt>To complete</dt>
                  <dd>{money(value.missing)}</dd>
                </div>
              </dl>
            )}
            {/* Only worth saying when it differs from the market value above (graded copies, duplicates…) */}
            {yourCopies > 0 && (!value || Math.abs(yourCopies - value.owned) >= 0.5) && (
              <p className="faint small">
                Your copies from this set are worth {money(yourCopies)}, going by their printing, condition and grade.
              </p>
            )}
          </section>
          <div className="toolbar">
            <div className="segmented small">
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
                All {cards.length}
              </button>
              <button className={show === 'owned' ? 'on' : ''} onClick={() => setShow('owned')}>
                Owned {owned}
              </button>
              <button className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>
                Missing {missing}
              </button>
            </div>
            {prices && (
              <select value={order} onChange={(e) => setOrder(e.target.value as Order)} aria-label="Order cards">
                <option value="number">By number</option>
                <option value="priceHigh">Price: high → low</option>
                <option value="priceLow">Price: low → high</option>
              </select>
            )}
          </div>
          {shown.length === 0 && <p className="muted center">{show === 'owned' ? 'None of this set yet.' : 'Nothing missing. 🎉'}</p>}
          <div className="grid binder">
            {shown.map((c) => {
              const price = prices ? priceOf(c) : undefined;
              return (
                <CatalogTile
                  key={c.id}
                  card={c}
                  owned={ownedCount(ownedByCard.get(c.id))}
                  price={price === undefined ? undefined : price === null ? null : format(price, currency)}
                />
              );
            })}
          </div>
          {value && (
            <p className="faint small center">
              Market prices for one near-mint copy of each card (TCGplayer, or Cardmarket for cards TCGplayer doesn't list), updated{' '}
              {shortDate(prices!.updated)}.{value.priced < cards.length && ` ${cards.length - value.priced} of these cards have no price yet.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
