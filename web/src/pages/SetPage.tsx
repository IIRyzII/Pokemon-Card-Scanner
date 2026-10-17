import { useMemo, useState } from 'react';
import { CatalogTile } from '../components/CardTile.tsx';
import { IconBack } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { shortDate } from '../lib/format.ts';
import { goBack } from '../lib/router.ts';
import { percentText, setLogoUrl } from '../lib/sets.ts';
import { useCatalog } from '../lib/useCatalog.ts';

type Show = 'all' | 'owned' | 'missing';

/** One set laid out like a binder: every card in number order, the ones you don't have greyed out. */
export function SetPage({ id }: { id: string }) {
  const { catalog, error } = useCatalog();
  const { ownedByCard, data } = useCollection();
  const { convert, format, currency } = useCurrency();
  const [show, setShow] = useState<Show>('all');
  const set = catalog?.sets.find((s) => s.id === id);
  const cards = useMemo(() => catalog?.bySet.get(id) ?? [], [catalog, id]);
  const owned = cards.filter((c) => ownedByCard.has(c.id)).length;
  const missing = cards.length - owned;
  const shown = cards.filter((c) => show === 'all' || (show === 'owned') === ownedByCard.has(c.id));

  const value = useMemo(() => {
    const ids = new Set(cards.map((c) => c.id));
    return (data?.items ?? [])
      .filter((i) => ids.has(i.cardId))
      .reduce((sum, i) => sum + (convert(i.value, i.valueCurrency ?? 'USD') ?? 0) * i.quantity, 0);
  }, [data, cards, convert]);
  const secret = set?.official && cards.length > set.official ? cards.length - set.official : 0;
  const logo = set ? setLogoUrl(set) : null;

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
            <p className="muted">
              {[set.serieName, set.date && `released ${shortDate(set.date)}`, set.code].filter(Boolean).join(' · ')}
            </p>
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
            <p className="faint small">
              {missing === 0 ? 'Complete! ' : `${missing} to go. `}
              {value > 0 && `Your cards from this set are worth ${format(value, currency)}.`}
            </p>
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
          </div>
          {shown.length === 0 && <p className="muted center">{show === 'owned' ? 'None of this set yet.' : 'Nothing missing. 🎉'}</p>}
          <div className="grid binder">
            {shown.map((c) => (
              <CatalogTile key={c.id} card={c} owned={ownedCount(ownedByCard.get(c.id))} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
