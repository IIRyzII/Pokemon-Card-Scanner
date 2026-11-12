// Selling, in the collection: the copies for sale, the sales history (by month, with what each
// sale made, and undo), and the cards worth selling.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import type { CollectionItem, SoldItem } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { gradeBadge } from '../components/CardTile.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconExternal } from '../components/Icons.tsx';
import { ListingSheet, SellSheet } from '../components/SellSheets.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { money, shortDate } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { monthName, saleResult, salesByMonth, salesTotals, sellSuggestions, type Suggestion } from '../lib/selling.ts';

type Tab = 'selling' | 'sold' | 'ideas';
const TABS: Record<Tab, string> = { selling: 'For sale', sold: 'Sold', ideas: 'What to sell' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number, currency: string) => `${n < 0 ? '−' : '+'}${money(Math.abs(n), currency)}`;

export function SellingSection({ canEdit }: { canEdit: boolean }) {
  const { data, reload } = useCollection();
  const { convert, currency, format } = useCurrency();
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>('selling');
  const [sold, setSold] = useState<SoldItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<{ item: CollectionItem; copies?: number } | null>(null);
  const [selling, setSelling] = useState<CollectionItem | null>(null);

  const loadSold = useCallback(() => {
    setError(null);
    api.soldItems().then(
      (r) => setSold(r.sold),
      (err: Error) =>
        setError(err instanceof ApiError && err.status === 404 ? 'Selling needs the latest version of the server: ask whoever runs it to update it.' : err.message),
    );
  }, []);
  useEffect(loadSold, [loadSold]);

  const items = data?.items ?? [];
  const forSale = useMemo(() => items.filter((i) => i.forSale > 0).sort((a, b) => (b.listedAt ?? '').localeCompare(a.listedAt ?? '')), [items]);
  const each = (i: CollectionItem) => convert(i.value, i.valueCurrency ?? 'USD');
  const asking = (i: CollectionItem) => (i.askingPrice === null ? null : convert(i.askingPrice, i.askingCurrency ?? currency));
  const askingTotal = forSale.reduce((n, i) => n + (asking(i) ?? each(i) ?? 0) * i.forSale, 0);
  const copiesForSale = forSale.reduce((n, i) => n + i.forSale, 0);
  const totals = useMemo(() => salesTotals(sold ?? [], convert), [sold, convert]);
  const months = useMemo(() => salesByMonth(sold ?? [], convert), [sold, convert]);
  const ideas = useMemo(() => sellSuggestions(items, convert), [items, convert]);

  async function undo(s: SoldItem) {
    const ok = await confirm({
      title: 'Undo this sale?',
      body: `${s.quantity > 1 ? `${s.quantity} × ` : ''}${s.name} go back in the collection${s.saleId ? ', and the sale logged for its value is removed' : ''}.`,
      confirmText: 'Undo sale',
    });
    if (!ok) return;
    try {
      const r = await api.undoSale(s.id);
      toast(r.restored ? `${s.name} is back in the collection` : "Sale removed. Its entry was deleted for good, so the copies couldn't go back.");
      loadSold();
      void reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const changed = () => {
    setListing(null);
    setSelling(null);
    void reload();
    loadSold();
  };

  return (
    <>
      <section className="summary">
        <div>
          <div className="muted small">For sale</div>
          <div className="big-value">{format(askingTotal, currency)}</div>
          <div className="faint small">
            {plural(copiesForSale, 'copy', 'copies')}, at their asking prices (or values)
          </div>
        </div>
        <div className="stats">
          <div>
            <b>{sold ? format(totals.takings, currency) : '—'}</b>
            <span>sold</span>
          </div>
          <div>
            {sold ? <b className={totals.profit >= 0 ? 'sealed-gain' : 'sealed-loss'}>{signed(totals.profit, currency)}</b> : <b>—</b>}
            <span>profit</span>
          </div>
        </div>
      </section>

      <div className="segmented small full" role="group" aria-label="Selling">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {TABS[t]}
            {t === 'selling' && forSale.length > 0 && ` · ${forSale.length}`}
          </button>
        ))}
      </div>
      {error && (
        <p className="error">
          {error}{' '}
          <button className="link" onClick={loadSold}>
            Try again
          </button>
        </p>
      )}

      {tab === 'selling' &&
        (forSale.length ? (
          <ul className="sell-list">
            {forSale.map((i) => {
              const ask = asking(i);
              return (
                <li key={i.id} className="sell-row">
                  <a className="sell-card" href={href('item', i.id)}>
                    <CardImage base={i.image} name={i.name} setId={i.setId} number={i.number} />
                  </a>
                  <div className="sell-info">
                    <a href={href('item', i.id)}>
                      <b>{i.name}</b>
                    </a>
                    <span className="faint small">
                      {i.setName} · #{cardNumberText(i.number, i.setTotal)} · {gradeBadge(i)}
                    </span>
                    <span className="small">
                      {i.forSale} of {i.quantity} · {ask === null ? 'no asking price' : `asking ${format(ask, currency)}`}
                      <span className="faint"> · worth {format(each(i), currency)}</span>
                    </span>
                    <span className="faint small">
                      {i.salePlatform ?? 'Not listed anywhere yet'}
                      {i.listingUrl && (
                        <>
                          {' · '}
                          <a href={i.listingUrl} target="_blank" rel="noreferrer">
                            listing <IconExternal />
                          </a>
                        </>
                      )}
                      {i.listedAt && ` · since ${shortDate(i.listedAt)}`}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="sell-actions">
                      <button className="btn small primary" onClick={() => setSelling(i)}>
                        Sold
                      </button>
                      <button className="btn small" onClick={() => setListing({ item: i })}>
                        Edit
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <h2>Nothing for sale yet</h2>
            <p className="muted">Open a card in your collection and tap For sale, or see What to sell for ideas.</p>
          </div>
        ))}

      {tab === 'sold' &&
        (!sold ? (
          !error && <div className="spinner" aria-label="Loading" />
        ) : sold.length ? (
          months.map(({ month, sales, totals: t }) => (
            <section key={month} className="group">
              <h2 className="group-head">
                {monthName(month)}
                <span className="group-count small">
                  {plural(t.copies, 'card')} · {format(t.takings, currency)}
                  {t.costed > 0 && ` · profit ${signed(t.profit, currency)}`}
                </span>
              </h2>
              <ul className="sell-list">
                {sales.map((s) => {
                  const r = saleResult(s, convert);
                  return (
                    <li key={s.id} className="sell-row">
                      <span className="sell-card">
                        <CardImage base={s.image} name={s.name} number={s.number ?? undefined} />
                      </span>
                      <div className="sell-info">
                        <a href={href('card', s.cardId)}>
                          <b>{s.name}</b>
                        </a>
                        <span className="faint small">
                          {s.setName} · #{cardNumberText(s.number ?? '', s.setTotal)} · {gradeBadge(s)}
                        </span>
                        <span className="small">
                          {s.quantity > 1 && `${s.quantity} × `}
                          {format(s.price, s.currency)} · {s.platform ?? 'sold'} · {shortDate(s.soldOn)}
                        </span>
                        {r && (
                          <span className="faint small">
                            {(s.fees ?? 0) + (s.postage ?? 0) > 0 && `costs ${format(r.costs, currency)} · `}
                            {r.profit === null ? 'no price paid recorded' : <span className={r.profit >= 0 ? 'sealed-gain' : 'sealed-loss'}>profit {signed(r.profit, currency)}</span>}
                          </span>
                        )}
                        {s.note && <span className="faint small">{s.note}</span>}
                      </div>
                      {canEdit && (
                        <div className="sell-actions">
                          <button className="btn small" onClick={() => void undo(s)}>
                            Undo
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : (
          <div className="empty">
            <h2>No sales yet</h2>
            <p className="muted">When you sell a card, record it with Sold: it leaves the collection and its profit shows here.</p>
          </div>
        ))}

      {tab === 'ideas' &&
        (ideas.length ? (
          <>
            <p className="muted small">Your spare copies (keeping your best copy of each card), then the cards that have gained most since you bought them.</p>
            <ul className="sell-list">
              {ideas.map((s) => (
                <Idea key={`${s.item.id}${s.reason}`} s={s} canEdit={canEdit} onList={() => setListing({ item: s.item, copies: s.copies })} />
              ))}
            </ul>
          </>
        ) : (
          <div className="empty">
            <h2>No suggestions</h2>
            <p className="muted">Spare copies, and cards worth more than you paid (with a price paid recorded), show up here.</p>
          </div>
        ))}

      {listing && <ListingSheet item={listing.item} copies={listing.copies} onClose={() => setListing(null)} onSaved={changed} />}
      {selling && <SellSheet item={selling} onClose={() => setSelling(null)} onSold={changed} />}
    </>
  );
}

function Idea({ s, canEdit, onList }: { s: Suggestion; canEdit: boolean; onList: () => void }) {
  const { currency, format } = useCurrency();
  const i = s.item;
  return (
    <li className="sell-row">
      <a className="sell-card" href={href('item', i.id)}>
        <CardImage base={i.image} name={i.name} setId={i.setId} number={i.number} />
      </a>
      <div className="sell-info">
        <a href={href('item', i.id)}>
          <b>{i.name}</b>
        </a>
        <span className="faint small">
          {i.setName} · #{cardNumberText(i.number, i.setTotal)} · {gradeBadge(i)}
        </span>
        <span className="small">
          {s.reason === 'spare'
            ? `${plural(s.copies, 'spare copy', 'spare copies')} · worth ${format(s.each, currency)} each`
            : `Worth ${format(s.each, currency)}, you paid ${format(s.paidEach, currency)}: up ${format(s.each - (s.paidEach ?? 0), currency)}`}
        </span>
      </div>
      {canEdit && (
        <div className="sell-actions">
          <button className="btn small" onClick={onList}>
            For sale
          </button>
        </div>
      )}
    </li>
  );
}
