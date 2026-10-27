// One binder as it is on the shelf, page by page: the cards you have in colour, the rest greyed
// out, each pocket noting its printing. Or the list of what's still missing and where it goes.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BINDER_COLOURS, POCKET_LAYOUTS, colourOf, type Pockets } from '../../../shared/binders.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { Binder, CollectionItem } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconBack, IconCamera, IconEdit } from '../components/Icons.tsx';
import { defaultFields } from '../components/ItemForm.tsx';
import { PageScanner } from '../components/PageScanner.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { api } from '../lib/api.ts';
import {
  binderStats,
  copyToRemove,
  fixBinderPrintings,
  knownPrintings,
  missingOf,
  ownedPrintings,
  pagesOf,
  percentFilled,
  pocketsOf,
  printingNote,
  promosOf,
  isPromoPrinting,
  withPending,
  type KnownPrintings,
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
  /** The page being scanned (0-based) */
  const [scanning, setScanning] = useState<number | null>(null);
  const canEdit = hasRole(user?.role, 'editor');
  const { toast } = useFeedback();

  useEffect(() => {
    api.binder(id).then(
      (r) => setBinder(r.binder),
      (err: Error) => setError(err.message),
    );
  }, [id]);

  // Printings a card doesn't come in (saved before they were known) count as its main one.
  const known = useMemo(() => knownPrintings(catalog), [catalog]);
  const steps = useCopySteps(known);
  const cards = useMemo(() => (binder ? fixBinderPrintings(binder.cards, known) : []), [binder, known]);
  const owned = useMemo(() => withPending(ownedPrintings(data?.items ?? [], known), steps.pending), [data, known, steps.pending]);
  const pockets = useMemo(() => pocketsOf(cards, owned), [cards, owned]);
  // Printings only promos come in (a grand master set's last pages), so their pockets can say so.
  const promos = useMemo(
    () => (catalog ? promosOf(catalog, cards.flatMap((c) => catalog.byId.get(c.cardId) ?? [])) : new Set<string>()),
    [catalog, cards],
  );

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
                    <span className="binder-page-tools">
                      <span className="faint">
                        {page.filter((p) => p.filled).length}/{page.length}
                      </span>
                      {canEdit && page.some((p) => !p.filled) && (
                        <button type="button" className="btn small" onClick={() => setScanning(i)} aria-label={`Scan page ${i + 1}`}>
                          <IconCamera width={15} height={15} /> Scan
                        </button>
                      )}
                    </span>
                  </h2>
                  <div className="pockets" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
                    {page.map((p, j) => (
                      <PocketView
                        key={j}
                        pocket={p}
                        card={card(p.cardId)}
                        promo={isPromoPrinting(promos, p.cardId, p.variant) || !!card(p.cardId)?.versionOf}
                        copies={owned.get(`${p.cardId}|${p.variant}`) ?? 0}
                        steps={canEdit ? steps : null}
                      />
                    ))}
                    {Array.from({ length: perPage - page.length }, (_, j) => (
                      <div key={`empty-${j}`} className="pocket spare" aria-hidden="true" />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <MissingList
              missing={missing}
              catalog={catalog}
              priceOf={priceOf}
              format={(v) => format(v, currency)}
              owned={owned}
              steps={canEdit ? steps : null}
            />
          )}
          {scanning !== null && pages[scanning] && (
            <PageScanner
              pageNo={scanning + 1}
              cols={columns}
              rows={Math.ceil(perPage / columns)}
              pockets={pages[scanning]}
              cardOf={card}
              onAdd={(found) => {
                for (const p of found) steps.add(p.cardId, p.variant);
                toast(`Adding ${found.length} card${found.length === 1 ? '' : 's'} from page ${scanning + 1}`);
              }}
              onClose={() => setScanning(null)}
            />
          )}
          <p className="faint small center">
            A pocket is in colour when the collection has a copy of that card in that printing (any condition or grade); each copy fills one
            pocket.
            {canEdit && ' Scan on a page checks a photo of the real page and fills the pockets it finds.'}
            {canEdit && ' + adds a copy (raw, near mint) to the collection and − takes one out, so you can fill the binder as you go.'}
          </p>
        </>
      )}
    </div>
  );
}

interface CopySteps {
  /** Taps not in the collection yet ("card id|printing", +1 or −1) */
  pending: { key: string; delta: number }[];
  add: (cardId: string, variant: string) => void;
  remove: (cardId: string, variant: string) => void;
}

/**
 * The + and − by each card: a copy of it in that printing into the collection (raw, near mint, as
 * adding one starts out), or the raw copy added last out of it (to the trash, like removing it on
 * its own page). Pockets change as soon as they're tapped; the taps are sent one after another,
 * then the collection is fetched again.
 */
function useCopySteps(known: KnownPrintings): CopySteps {
  const { data, reload } = useCollection();
  const { currency } = useCurrency();
  const { toast } = useFeedback();
  const [pending, setPending] = useState<{ id: number; key: string; delta: number }[]>([]);
  // The collection as the taps so far have left it, for which copy a − takes out
  const items = useRef<CollectionItem[]>([]);
  const queue = useRef(Promise.resolve());
  const waiting = useRef(0);
  const sent = useRef(new Set<number>());
  const nextId = useRef(0);
  useEffect(() => {
    if (!waiting.current) items.current = data?.items ?? [];
  }, [data]);

  const run = (cardId: string, variant: string, delta: 1 | -1, send: () => Promise<void>) => {
    const id = nextId.current++;
    setPending((p) => [...p, { id, key: `${cardId}|${variant}`, delta }]);
    waiting.current++;
    queue.current = queue.current
      .then(send)
      .then(
        () => void sent.current.add(id),
        (err: Error) => {
          setPending((p) => p.filter((c) => c.id !== id));
          toast(err.message, 'error');
        },
      )
      .then(async () => {
        if (--waiting.current) return;
        const settled = new Set(sent.current);
        sent.current.clear();
        await reload();
        setPending((p) => p.filter((c) => !settled.has(c.id)));
      });
  };

  return {
    pending,
    add: (cardId, variant) =>
      run(cardId, variant, 1, async () => {
        const { item } = await api.addItem({ cardId, ...defaultFields([variant], currency) });
        items.current = [...items.current.filter((i) => i.id !== item.id), item];
      }),
    remove: (cardId, variant) => {
      // (While taps are being sent, the copy may be one just added: the − waits its turn.)
      if (!waiting.current && !copyToRemove(items.current, cardId, variant, known)) {
        toast('Only graded copies of it are left: take a slab out on its own page', 'error');
        return;
      }
      run(cardId, variant, -1, async () => {
        const copy = copyToRemove(items.current, cardId, variant, known);
        if (!copy) throw new Error('There’s no raw copy of it left to take out');
        if (copy.quantity > 1) {
          const { item } = await api.updateItem(copy.id, { quantity: copy.quantity - 1 });
          items.current = items.current.map((i) => (i.id === item.id ? item : i));
        } else {
          await api.removeItem(copy.id);
          items.current = items.current.filter((i) => i.id !== copy.id);
        }
      });
    },
  };
}

/** − (count) + for a card in a printing */
function CopyStepper({ cardId, variant, name, copies, steps }: { cardId: string; variant: string; name: string; copies: number; steps: CopySteps }) {
  const label = `${name} (${printingNote(variant)})`;
  return (
    <div className="copy-steps">
      <button type="button" onClick={() => steps.remove(cardId, variant)} disabled={!copies} aria-label={`Take a ${label} out of the collection`}>
        −
      </button>
      <span className="copy-count" title="Copies in the collection">
        {copies}
        <span className="sr-only"> in the collection</span>
      </span>
      <button type="button" onClick={() => steps.add(cardId, variant)} aria-label={`Add a ${label} to the collection`}>
        +
      </button>
    </div>
  );
}

interface PocketProps {
  pocket: Pocket;
  card: CatalogCard | undefined;
  promo: boolean;
  /** Copies the collection has of its card in its printing */
  copies: number;
  /** The + and − (editors) */
  steps: CopySteps | null;
}

function PocketView({ pocket, card, promo, copies, steps }: PocketProps) {
  const note = `${printingNote(pocket.variant)}${promo ? ' · promo' : ''}`;
  const name = card?.name ?? pocket.cardId;
  return (
    <div className={`pocket${pocket.filled ? ' filled' : ''}`}>
      <a
        className="pocket-card"
        href={href('card', pocket.cardId)}
        title={`${name}${card ? ` · ${card.set.name} #${numberOf(card)}` : ''} · ${note}${pocket.filled ? '' : ' (missing)'}`}
      >
        <CardImage base={card?.image} name={name} setId={card?.set.id} number={card?.number} />
        <span className="pocket-note">
          {/* A stamped promo card from the promo set: "SVP #057", not the set's own #057 */}
          <span className="faint">
            {card?.versionOf && card.set.code ? `${card.set.code} ` : ''}#{card?.number ?? '?'}
          </span>{' '}
          {note}
        </span>
        <span className="sr-only">{pocket.filled ? 'You have it' : 'Missing'}</span>
      </a>
      {steps && <CopyStepper cardId={pocket.cardId} variant={pocket.variant} name={name} copies={copies} steps={steps} />}
    </div>
  );
}

interface MissingProps {
  missing: ReturnType<typeof missingOf>;
  catalog: Catalog | null;
  priceOf: (card: CatalogCard) => number | null;
  format: (v: number) => string;
  owned: Map<string, number>;
  steps: CopySteps | null;
}

function MissingList({ missing, catalog, priceOf, format, owned, steps }: MissingProps) {
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
              {steps && (
                <div className="scan-entry-actions">
                  <CopyStepper
                    cardId={m.cardId}
                    variant={m.variant}
                    name={card?.name ?? m.cardId}
                    copies={owned.get(`${m.cardId}|${m.variant}`) ?? 0}
                    steps={steps}
                  />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
