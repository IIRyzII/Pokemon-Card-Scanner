// The collection's sealed products: booster boxes, Elite Trainer Boxes, packs, tins and the rest,
// valued at Cardmarket's prices (the catalogue's sealed.json), against what was paid.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CURRENCIES } from '../../../shared/currency.ts';
import { sealedCardmarketUrl, sealedEbaySoldUrl } from '../../../shared/links.ts';
import { SEALED_TYPES } from '../../../shared/sealed.ts';
import type { SealedItem } from '../../../shared/types.ts';
import { useFeedback } from '../components/feedback.tsx';
import { IconExternal, IconPlus, IconSearch } from '../components/Icons.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrency } from '../lib/currency.tsx';
import { relativeTime } from '../lib/format.ts';
import { searchSealed, sealedTotals, sealedValue } from '../lib/sealed.ts';
import { loadSealed, type SealedCatalogue, type SealedProduct } from '../lib/useCatalog.ts';
import { normName } from '../lib/catalog.ts';

/** The most of one product an entry holds (the API's limit too) */
const MOST = 999;
const KINDS = SEALED_TYPES.filter((t) => t !== 'Other');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function useSealedCatalogue(): SealedCatalogue | null | undefined {
  const [catalogue, setCatalogue] = useState<SealedCatalogue | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadSealed().then((c) => alive && setCatalogue(c));
    return () => {
      alive = false;
    };
  }, []);
  return catalogue;
}

export function SealedSection({ canEdit }: { canEdit: boolean }) {
  const { format, convert, currency } = useCurrency();
  const catalogue = useSealedCatalogue();
  const [items, setItems] = useState<SealedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SealedItem | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');

  const load = useCallback(() => {
    setError(null);
    api.sealed().then(
      (r) => setItems(r.items),
      (err: Error) =>
        setError(err instanceof ApiError && err.status === 404 ? 'Sealed products need the latest version of the server: ask whoever runs it to update it.' : err.message),
    );
  }, []);
  useEffect(load, [load]);

  const valueOf = useCallback((item: SealedItem) => sealedValue(item, catalogue?.byId.get(item.productId), convert, currency), [catalogue, convert, currency]);
  const totals = useMemo(() => sealedTotals(items ?? [], valueOf), [items, valueOf]);
  const shown = useMemo(() => {
    const words = normName(query).split(' ').filter(Boolean);
    return (items ?? []).filter((i) => (!kind || i.type === kind) && words.every((w) => normName(`${i.name} ${catalogue?.byId.get(i.productId)?.set?.name ?? ''}`).includes(w)));
  }, [items, query, kind, catalogue]);
  const kinds = useMemo(() => KINDS.filter((k) => items?.some((i) => i.type === k)), [items]);
  const gain = totals.paidValue - totals.paid;

  return (
    <>
      <section className="summary">
        <div>
          <div className="muted small">Sealed value</div>
          <div className="big-value">{items ? format(totals.value, currency) : '—'}</div>
          {catalogue && <div className="prices-status faint small">Cardmarket prices updated {relativeTime(catalogue.updated)}</div>}
        </div>
        <div className="stats">
          <div>
            <b>{totals.count}</b>
            <span>{totals.count === 1 ? 'product' : 'products'}</span>
          </div>
          <div>
            <b>{totals.entries}</b>
            <span>entries</span>
          </div>
        </div>
        {totals.costed > 0 && (
          <div className="small">
            {format(totals.paid, currency)} paid for {plural(totals.costed, 'entry', 'entries')}, worth {format(totals.paidValue, currency)} now:{' '}
            <b className={gain >= 0 ? 'sealed-gain' : 'sealed-loss'}>
              {gain >= 0 ? '+' : '−'}
              {format(Math.abs(gain), currency)}
            </b>
          </div>
        )}
        {totals.unpriced > 0 && <div className="faint small">{totals.unpriced} without a price</div>}
      </section>

      {catalogue === null && <p className="note small">The list of sealed products isn't available yet, so they can't be added or valued. It comes with the next catalogue update.</p>}
      {error && (
        <p className="error">
          {error}{' '}
          <button className="link" onClick={load}>
            Try again
          </button>
        </p>
      )}

      {items && items.length > 0 && (
        <div className="toolbar">
          <div className="search">
            <IconSearch />
            <input type="search" placeholder="Search your sealed products…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sealed products" />
          </div>
          {kinds.length > 1 && (
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of product">
              <option value="">Every kind</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {!items && !error && <div className="spinner" aria-label="Loading" />}
      {items && items.length === 0 && (
        <div className="empty">
          <h2>No sealed products yet</h2>
          {canEdit ? (
            <>
              <p className="muted">Add booster boxes, Elite Trainer Boxes, packs, tins and more, and see what they're worth.</p>
              <button className="btn primary" onClick={() => setAdding(true)} disabled={!catalogue}>
                <IconPlus /> Add a sealed product
              </button>
            </>
          ) : (
            <p className="muted">Sealed products added by editors will show up here.</p>
          )}
        </div>
      )}
      {items && items.length > 0 && shown.length === 0 && <p className="muted center">No sealed products match.</p>}

      {shown.length > 0 && (
        <ul className="sealed-list">
          {shown.map((item) => {
            const product = catalogue?.byId.get(item.productId);
            const v = valueOf(item);
            const change = v.total !== null && v.paid !== null ? v.total - v.paid : null;
            return (
              <li key={item.id}>
                <button className="sealed-row" onClick={() => setEditing(item)}>
                  <span className="sealed-info">
                    <span className="sealed-name">{item.name}</span>
                    <span className="faint small">
                      {[item.type, product?.set?.name].filter(Boolean).join(' · ')}
                      {item.quantity > 1 && ` · ${format(v.each, currency)} each`}
                    </span>
                  </span>
                  <span className="sealed-qty">×{item.quantity}</span>
                  <span className="sealed-value">
                    <b>{format(v.total, currency)}</b>
                    {change !== null && (
                      <span className={`small ${change >= 0 ? 'sealed-gain' : 'sealed-loss'}`}>
                        {change >= 0 ? '+' : '−'}
                        {format(Math.abs(change), currency)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && items && items.length > 0 && (
        <button className="fab" onClick={() => setAdding(true)} aria-label="Add a sealed product" disabled={!catalogue}>
          <IconPlus />
        </button>
      )}
      {adding && catalogue && (
        <AddSealed
          catalogue={catalogue}
          onClose={() => setAdding(false)}
          onAdded={(item) => {
            setItems((list) => [item, ...(list ?? [])]);
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <SealedSheet
          item={editing}
          product={catalogue?.byId.get(editing.productId)}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={(item) => {
            setItems((list) => list?.map((i) => (i.id === item.id ? item : i)) ?? null);
            setEditing(null);
          }}
          onRemoved={(id) => {
            setItems((list) => list?.filter((i) => i.id !== id) ?? null);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

// ---------- adding one ----------

function AddSealed({ catalogue, onClose, onAdded }: { catalogue: SealedCatalogue; onClose: () => void; onAdded: (item: SealedItem) => void }) {
  const { format, currency } = useCurrency();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [chosen, setChosen] = useState<SealedProduct | null>(null);
  const results = useMemo(() => searchSealed(catalogue.products, query, kind || null), [catalogue, query, kind]);

  if (chosen) return <SealedSheet product={chosen} canEdit onClose={onClose} onBack={() => setChosen(null)} onSaved={onAdded} />;
  return (
    <Sheet title="Add a sealed product" onClose={onClose} wide>
      <div className="sealed-search">
        <div className="search">
          <IconSearch />
          <input
            type="search"
            autoFocus
            placeholder="e.g. 151 elite trainer box"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search sealed products"
          />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of product">
          <option value="">Every kind</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <p className="faint small">
        {plural(catalogue.products.length, 'product')} from Cardmarket, newest first.{results.length === 60 ? ' Showing the first 60: search to narrow them down.' : ''}
      </p>
      {results.length ? (
        <ul className="sealed-list">
          {results.map((p) => (
            <li key={p.id}>
              <button className="sealed-row" onClick={() => setChosen(p)}>
                <span className="sealed-info">
                  <span className="sealed-name">{p.name}</span>
                  <span className="faint small">{[p.type, p.set?.name].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="sealed-value">
                  <b>{p.price === null ? '—' : format(p.price, 'EUR')}</b>
                  {p.price !== null && currency !== 'EUR' && <span className="faint small">Cardmarket</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted center">No products match.</p>
      )}
    </Sheet>
  );
}

// ---------- one entry: adding its details, or changing them ----------

interface SheetProps {
  /** The entry, when changing one already in the collection */
  item?: SealedItem;
  product: SealedProduct | undefined;
  canEdit: boolean;
  onClose: () => void;
  /** Adding: back to the search */
  onBack?: () => void;
  onSaved: (item: SealedItem) => void;
  onRemoved?: (id: string) => void;
}

function SealedSheet({ item, product, canEdit, onClose, onBack, onSaved, onRemoved }: SheetProps) {
  const { format, convert, currency, ebayDomain } = useCurrency();
  const { toast, confirm } = useFeedback();
  const name = item?.name ?? product?.name ?? '';
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [price, setPrice] = useState(item?.purchasePrice != null ? String(item.purchasePrice) : '');
  const [priceCurrency, setPriceCurrency] = useState(item?.purchaseCurrency ?? currency);
  const [date, setDate] = useState(item?.purchaseDate ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const each = product?.price != null ? convert(product.price, 'EUR') : null;

  async function save() {
    const paid = price.trim() === '' ? null : Number(price);
    if (paid !== null && (!Number.isFinite(paid) || paid < 0)) return toast('The price paid must be a price', 'error');
    const details = { quantity, purchasePrice: paid, purchaseCurrency: paid === null ? null : priceCurrency, purchaseDate: date || null, notes: notes.trim() || null };
    setBusy(true);
    try {
      const saved = item
        ? (await api.updateSealed(item.id, details)).item
        : (await api.addSealed({ productId: product!.id, name, type: product!.type, ...details })).item;
      toast(item ? 'Saved' : `${name} is in the collection`);
      onSaved(saved);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    const ok = await confirm({ title: 'Remove it?', body: `${name} (×${item.quantity}) comes out of the collection.`, confirmText: 'Remove', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.removeSealed(item.id);
      toast('Removed');
      onRemoved?.(item.id);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={item ? 'Sealed product' : 'Add a sealed product'}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            {item ? (
              <button className="btn danger-outline" onClick={remove} disabled={busy}>
                Remove
              </button>
            ) : (
              onBack && (
                <button className="btn" onClick={onBack} disabled={busy}>
                  Back
                </button>
              )
            )}
            <button className="btn primary" onClick={save} disabled={busy}>
              {item ? 'Save' : 'Add to collection'}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="sealed-head">
        <div className="sealed-name big">{name}</div>
        <div className="muted small">{[item?.type ?? product?.type, product?.set?.name].filter(Boolean).join(' · ')}</div>
        <div className="sealed-price">
          <b>{each === null ? 'No price yet' : format(each, currency)}</b>
          <span className="faint small"> each · Cardmarket trend price{product?.price != null && currency !== 'EUR' ? ` (converted from EUR)` : ''}</span>
        </div>
        {!product && item && <p className="note small">This product is no longer in the catalogue's list, so it has no price.</p>}
      </div>

      {canEdit ? (
        <div className="form">
          <div className="row2">
            <label>
              How many
              <span className="stepper">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One fewer">
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MOST}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(MOST, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  aria-label="How many"
                />
                <button type="button" onClick={() => setQuantity((q) => Math.min(MOST, q + 1))} aria-label="One more">
                  +
                </button>
              </span>
            </label>
            <label>
              Bought on
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="row2">
            <label>
              Price paid for one
              <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="Optional" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label>
              Currency
              <select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Notes
            <input type="text" maxLength={500} placeholder="e.g. Pokémon Center exclusive, small dent" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      ) : (
        item && (
          <p className="small">
            ×{item.quantity}
            {item.purchasePrice != null && ` · paid ${format(item.purchasePrice, item.purchaseCurrency ?? currency)} each`}
            {item.notes && <span className="faint"> · {item.notes}</span>}
          </p>
        )
      )}

      <div className="link-row">
        <a className="chip" href={sealedCardmarketUrl(name)} target="_blank" rel="noreferrer">
          Cardmarket <IconExternal />
        </a>
        <a className="chip" href={sealedEbaySoldUrl(name, ebayDomain)} target="_blank" rel="noreferrer">
          eBay sold <IconExternal />
        </a>
      </div>
    </Sheet>
  );
}
