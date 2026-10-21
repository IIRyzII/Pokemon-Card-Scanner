// One binder as it is on the shelf, page by page: the cards you have in colour, the rest greyed
// out, each pocket noting its printing. Or the list of what's still missing and where it goes.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BINDER_COLOURS, POCKET_LAYOUTS, colourOf, type Pockets } from '../../../shared/binders.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { Binder } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { IconBack, IconEdit } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { api } from '../lib/api.ts';
import {
  binderStats,
  fixBinderPrintings,
  missingOf,
  ownedPrintings,
  pagesOf,
  percentFilled,
  pocketsOf,
  printingNote,
  type Pocket,
} from '../lib/binders.ts';
import type { Catalog, CatalogCard } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { goBack, href } from '../lib/router.ts';
import { priceLookup } from '../lib/sets.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';
import { layoutText } from './BindersPage.tsx';

const numberOf = (card: CatalogCard | undefined) => (card ? cardNumberText(card.number, card.set.official) : '');

export function BinderPage({ id }: { id: string }) {
  const { catalog } = useCatalog();
  const { data } = useCollection();
  const { user } = useSession();
  const prices = useMarketPrices();
  const { convert, format, currency } = useCurrency();
  const [binder, setBinder] = useState<Binder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'pages' | 'missing'>('pages');
  const canEdit = hasRole(user?.role, 'editor');

  useEffect(() => {
    api.binder(id).then(
      (r) => setBinder(r.binder),
      (err: Error) => setError(err.message),
    );
  }, [id]);

  // Printings a card doesn't come in (saved before they were known) count as its main one.
  const known = useCallback((cardId: string) => catalog?.byId.get(cardId)?.variants ?? null, [catalog]);
  const cards = useMemo(() => (binder ? fixBinderPrintings(binder.cards, known) : []), [binder, known]);
  const owned = useMemo(() => ownedPrintings(data?.items ?? [], known), [data, known]);
  const pockets = useMemo(() => pocketsOf(cards, owned), [cards, owned]);

  if (error || !binder) {
    return (
      <div className="page">
        <button className="back" onClick={() => goBack('/binders')}>
          <IconBack /> Binders
        </button>
        {error ? <p className="error">{error}</p> : <div className="spinner" aria-label="Loading binder" />}
      </div>
    );
  }

  const perPage = binder.pockets;
  const columns = POCKET_LAYOUTS[perPage as Pockets] ?? 3;
  const pages = pagesOf(pockets, perPage);
  const missing = missingOf(cards, pockets, perPage);
  const priceOf = priceLookup(prices, convert);
  const card = (cardId: string) => catalog?.byId.get(cardId);
  const priceOfId = (cardId: string) => {
    const c = card(cardId);
    return c ? priceOf(c) : null;
  };
  const { filled, value, toComplete } = binderStats(pockets, perPage, prices && catalog ? priceOfId : null);
  const money = (v: number) => format(v, currency, { round: true });

  return (
    <div className="page" style={{ '--binder': BINDER_COLOURS[colourOf(binder)].hex } as CSSProperties}>
      <button className="back" onClick={() => goBack('/binders')}>
        <IconBack /> Binders
      </button>
      <header className="binder-head">
        <div>
          <h1>
            <span className="swatch tall" aria-hidden="true" /> {binder.name}
          </h1>
          <p className="muted small">{layoutText(perPage, pockets.length)}</p>
        </div>
        {canEdit && (
          <a className="btn small" href={href('binder', binder.id, 'edit')}>
            <IconEdit width={16} height={16} /> Edit
          </a>
        )}
      </header>

      {pockets.length > 0 && (
        <section className="value-box">
          <div className="set-progress-line">
            <span>
              <b>{filled}</b> of {pockets.length} pockets filled
            </span>
            <b>{percentFilled({ filled, pockets: pockets.length })}</b>
          </div>
          <ProgressBar value={filled} max={pockets.length} label={`${binder.name}: pockets filled`} />
          <p className="faint small">
            {filled === pockets.length ? 'Every pocket is filled! 🎉' : `${missing.reduce((n, m) => n + m.need, 0)} cards to go.`}
          </p>
          {value !== null && (
            <dl className="set-values">
              <div>
                <dt>In it now</dt>
                <dd>{money(value)}</dd>
              </div>
              <div>
                <dt>To complete</dt>
                <dd>{money(toComplete ?? 0)}</dd>
              </div>
              <div>
                <dt>When full</dt>
                <dd>{money(value + (toComplete ?? 0))}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {pockets.length === 0 ? (
        <div className="empty">
          <p>This binder is empty.</p>
          {canEdit && (
            <a className="btn primary" href={href('binder', binder.id, 'edit')}>
              Add cards
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="segmented small" role="group" aria-label="Show">
              <button className={view === 'pages' ? 'on' : ''} aria-pressed={view === 'pages'} onClick={() => setView('pages')}>
                Pages
              </button>
              <button className={view === 'missing' ? 'on' : ''} aria-pressed={view === 'missing'} onClick={() => setView('missing')}>
                Missing ({missing.reduce((n, m) => n + m.need, 0)})
              </button>
            </div>
            {view === 'pages' && pages.length > 2 && (
              <select
                aria-label="Go to page"
                value=""
                onChange={(e) => document.getElementById(`page-${e.target.value}`)?.scrollIntoView({ behavior: 'smooth' })}
              >
                <option value="">Go to page…</option>
                {pages.map((_, i) => (
                  <option key={i} value={i + 1}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            )}
          </div>

          {view === 'pages' ? (
            <div className="binder-pages">
              {/* Like the open binder: page 1 is on the right, opposite the inside cover. */}
              <div className="binder-cover" aria-hidden="true">
                <span>{binder.name}</span>
              </div>
              {pages.map((page, i) => (
                <section key={i} id={`page-${i + 1}`} className="binder-page" aria-label={`Page ${i + 1}`}>
                  <h2 className="binder-page-no">
                    Page {i + 1}
                    <span className="faint">
                      {page.filter((p) => p.filled).length}/{page.length}
                    </span>
                  </h2>
                  <div className="pockets" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
                    {page.map((p, j) => (
                      <PocketView key={j} pocket={p} card={card(p.cardId)} />
                    ))}
                    {Array.from({ length: perPage - page.length }, (_, j) => (
                      <div key={`empty-${j}`} className="pocket spare" aria-hidden="true" />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <MissingList missing={missing} catalog={catalog} priceOf={priceOf} format={(v) => format(v, currency)} />
          )}
          <p className="faint small center">
            A pocket is in colour when the collection has a copy of that card in that printing (any condition or grade); each copy fills one
            pocket.
          </p>
        </>
      )}
    </div>
  );
}

function PocketView({ pocket, card }: { pocket: Pocket; card: CatalogCard | undefined }) {
  const note = printingNote(pocket.variant);
  const name = card?.name ?? pocket.cardId;
  return (
    <a
      className={`pocket${pocket.filled ? ' filled' : ''}`}
      href={href('card', pocket.cardId)}
      title={`${name}${card ? ` · ${card.set.name} #${numberOf(card)}` : ''} · ${note}${pocket.filled ? '' : ' (missing)'}`}
    >
      <CardImage base={card?.image} name={name} setId={card?.set.id} number={card?.number} />
      <span className="pocket-note">
        <span className="faint">#{card?.number ?? '?'}</span> {note}
      </span>
      <span className="sr-only">{pocket.filled ? 'You have it' : 'Missing'}</span>
    </a>
  );
}

interface MissingProps {
  missing: ReturnType<typeof missingOf>;
  catalog: Catalog | null;
  priceOf: (card: CatalogCard) => number | null;
  format: (v: number) => string;
}

function MissingList({ missing, catalog, priceOf, format }: MissingProps) {
  if (!missing.length) return <p className="muted center">Nothing missing: every pocket is filled.</p>;
  return (
    <ul className="scan-list">
      {missing.map((m) => {
        const card = catalog?.byId.get(m.cardId);
        const price = card ? priceOf(card) : null;
        return (
          <li key={m.line} className="scan-entry">
            <a href={href('card', m.cardId)} tabIndex={-1} aria-hidden="true">
              <CardImage base={card?.image} name={card?.name ?? m.cardId} setId={card?.set.id} number={card?.number} />
            </a>
            <div className="scan-entry-info">
              <div className="scan-entry-top">
                <a className="scan-entry-name" href={href('card', m.cardId)}>
                  {card?.name ?? m.cardId}
                </a>
                <span className="scan-entry-value">{m.need > 1 ? `need ${m.need}` : 'need 1'}</span>
              </div>
              <div className="muted small">
                {card ? `${card.set.name} · #${numberOf(card)}` : m.cardId}
              </div>
              <div className="small">
                {printingNote(m.variant)} · page {m.page}, pocket {m.pocket}
                {price !== null && <span className="faint"> · about {format(price)} each</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
