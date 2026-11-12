// Selling a copy from the collection: putting copies up for sale (with a ready-made listing title
// and description to copy), and recording a sale.

import { useState } from 'react';
import { CURRENCIES } from '../../../shared/currency.ts';
import { ebaySoldUrl } from '../../../shared/links.ts';
import { listingDescription, listingTitle, SALE_PLATFORMS, TITLE_LIMIT } from '../../../shared/selling.ts';
import type { CollectionItem, SoldItem } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useCatalog } from '../lib/useCatalog.ts';
import { canonicalArtist } from '../lib/catalog.ts';
import { useCurrency } from '../lib/currency.tsx';
import { money, todayIso } from '../lib/format.ts';
import { gradeBadge } from './CardTile.tsx';
import { useFeedback } from './feedback.tsx';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';

/** One copy's market value in the display currency, rounded to the penny, or null. */
function marketEach(item: CollectionItem, convert: (a: number | null | undefined, from: string) => number | null): number | null {
  const v = convert(item.value, item.valueCurrency ?? 'USD');
  return v === null ? null : Math.round(v * 100) / 100;
}

const priceText = (n: number | null) => (n === null ? '' : String(n));

function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="One fewer" disabled={value <= min}>
        −
      </button>
      <input type="number" inputMode="numeric" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))} />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="One more" disabled={value >= max}>
        +
      </button>
    </span>
  );
}

/** Copy to the clipboard, saying so. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useFeedback();
  return (
    <button
      type="button"
      className="btn small"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => toast(`${label} copied`),
          () => toast("Couldn't copy: select the text and copy it instead", 'error'),
        )
      }
    >
      Copy
    </button>
  );
}

interface ListingProps {
  item: CollectionItem;
  /** Copies to put up for sale, when not already listed (a suggestion's) */
  copies?: number;
  onClose: () => void;
  onSaved: (item: CollectionItem) => void;
}

/** Putting copies up for sale, or changing how they're listed. */
export function ListingSheet({ item, copies, onClose, onSaved }: ListingProps) {
  const { convert, currency, format, ebayDomain } = useCurrency();
  const { catalog } = useCatalog();
  const { toast, confirm } = useFeedback();
  const listed = item.forSale > 0;
  const each = marketEach(item, convert);
  const [forSale, setForSale] = useState(listed ? item.forSale : Math.min(item.quantity, Math.max(1, copies ?? 1)));
  const [price, setPrice] = useState(listed ? priceText(item.askingPrice) : priceText(each));
  const [priceCurrency, setPriceCurrency] = useState(item.askingCurrency ?? currency);
  const [platform, setPlatform] = useState(item.salePlatform ?? 'eBay');
  const [url, setUrl] = useState(item.listingUrl ?? '');
  const [busy, setBusy] = useState(false);
  const copy = { ...item, artist: canonicalArtist(catalog, item.artist) };
  const title = listingTitle(copy);
  const description = listingDescription(copy);
  const ref = { name: item.name, number: item.number, setName: item.setName, setTotal: item.setTotal };

  async function save() {
    const asking = price.trim() === '' ? null : Number(price);
    if (asking !== null && (!Number.isFinite(asking) || asking < 0)) return toast('The asking price must be a price', 'error');
    setBusy(true);
    try {
      const { item: saved } = await api.listItem(item.id, {
        forSale,
        askingPrice: asking,
        askingCurrency: asking === null ? null : priceCurrency,
        salePlatform: platform || null,
        listingUrl: url.trim() || null,
      });
      toast(listed ? 'Listing saved' : `${item.name} is up for sale`);
      onSaved(saved);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  async function takeOff() {
    if (!(await confirm({ title: 'Take it off sale?', body: `${item.name} stays in the collection, no longer for sale.`, confirmText: 'Take off sale' }))) return;
    setBusy(true);
    try {
      const { item: saved } = await api.unlistItem(item.id);
      toast('Taken off sale');
      onSaved(saved);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={listed ? 'For sale' : 'Put up for sale'}
      onClose={onClose}
      footer={
        <>
          {listed && (
            <button className="btn danger-outline" onClick={takeOff} disabled={busy}>
              Take off sale
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={busy}>
            {listed ? 'Save' : 'Put up for sale'}
          </button>
        </>
      }
    >
      <div className="sell-head">
        <b>{item.name}</b>
        <span className="muted small">
          {item.setName} · #{item.number} · {gradeBadge(item)}
          {item.quantity > 1 && ` · you have ${item.quantity}`}
        </span>
        <span className="small">
          Worth {each === null ? 'no price yet' : format(each, currency)} each{item.valueDetail ? <span className="faint"> · {item.valueDetail}</span> : null}
        </span>
      </div>
      <div className="form">
        <div className="row2">
          <label>
            Copies for sale
            <Stepper value={forSale} min={1} max={item.quantity} label="Copies for sale" onChange={setForSale} />
          </label>
          <label>
            Selling on
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {SALE_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row2">
          <label>
            Asking price for one
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
          Listing link
          <input type="url" inputMode="url" placeholder="https://… (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <p className="faint small">
          Check what it really sells for:{' '}
          <a href={ebaySoldUrl(ref, item.grader, item.grade, item.gradeLabel, ebayDomain)} target="_blank" rel="noreferrer">
            eBay sold listings <IconExternal />
          </a>
        </p>
      </div>

      <div className="listing-text">
        <h3>Listing text</h3>
        <div className="listing-copy">
          <div>
            <div className="faint small">
              Title · {title.length}/{TITLE_LIMIT}
            </div>
            <p className="listing-title">{title}</p>
          </div>
          <CopyButton text={title} label="Title" />
        </div>
        <div className="listing-copy">
          <div>
            <div className="faint small">Description</div>
            <pre className="listing-description">{description}</pre>
          </div>
          <CopyButton text={description} label="Description" />
        </div>
      </div>
    </Sheet>
  );
}

const PLATFORM_DEFAULT = 'eBay';

interface SellProps {
  item: CollectionItem;
  onClose: () => void;
  /** `item`: the entry after the sale (null: its last copies were sold) */
  onSold: (sold: SoldItem, item: CollectionItem | null) => void;
}

/** Recording a sale: the copies leave the collection, the sale goes in the history. */
export function SellSheet({ item, onClose, onSold }: SellProps) {
  const { convert, currency, format } = useCurrency();
  const { toast } = useFeedback();
  const each = marketEach(item, convert);
  const asking = item.askingPrice !== null ? convert(item.askingPrice, item.askingCurrency ?? currency) : null;
  const [quantity, setQuantity] = useState(Math.min(item.quantity, Math.max(1, item.forSale || 0)));
  const [price, setPrice] = useState(priceText(asking !== null ? Math.round(asking * 100) / 100 : each));
  const [priceCurrency, setPriceCurrency] = useState<string>(currency);
  const [fees, setFees] = useState('');
  const [postage, setPostage] = useState('');
  const [platform, setPlatform] = useState(item.salePlatform ?? PLATFORM_DEFAULT);
  const [soldOn, setSoldOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [logSale, setLogSale] = useState(true);
  const [busy, setBusy] = useState(false);

  const amount = (s: string) => (s.trim() === '' ? null : Number(s));
  const p = amount(price);
  const f = amount(fees) ?? 0;
  const post = amount(postage) ?? 0;
  const paidEach = convert(item.purchasePrice, item.purchaseCurrency ?? currency);
  const inDisplay = (n: number) => convert(n, priceCurrency);
  const takings = p === null || !Number.isFinite(p) ? null : inDisplay(p * quantity);
  const costs = inDisplay(f + post);
  const profit = takings === null || costs === null || paidEach === null ? null : takings - costs - paidEach * quantity;
  const last = quantity === item.quantity;

  async function sell() {
    if (p === null || !Number.isFinite(p) || p < 0) return toast('Enter what one sold for', 'error');
    for (const [v, what] of [
      [amount(fees), 'The fees'],
      [amount(postage), 'The postage'],
    ] as const) {
      if (v !== null && (!Number.isFinite(v) || v < 0)) return toast(`${what} must be an amount`, 'error');
    }
    setBusy(true);
    try {
      const r = await api.sellItem(item.id, {
        quantity,
        price: p,
        currency: priceCurrency,
        fees: amount(fees),
        postage: amount(postage),
        platform: platform || null,
        soldOn,
        note: note.trim() || null,
        logSale,
      });
      toast(`Sold ${quantity > 1 ? `${quantity} × ` : ''}${item.name}`);
      onSold(r.sold, r.item);
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Record a sale"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={sell} disabled={busy}>
          {busy ? 'Saving…' : 'Record the sale'}
        </button>
      }
    >
      <div className="sell-head">
        <b>{item.name}</b>
        <span className="muted small">
          {item.setName} · #{item.number} · {gradeBadge(item)} · you have {item.quantity}
        </span>
        <span className="small">
          Worth {each === null ? 'no price yet' : format(each, currency)} each
          {paidEach !== null && <span className="faint"> · you paid {format(paidEach, currency)}</span>}
        </span>
      </div>
      <div className="form">
        <div className="row2">
          <label>
            Copies sold
            <Stepper value={quantity} min={1} max={item.quantity} label="Copies sold" onChange={setQuantity} />
          </label>
          <label>
            Sold on
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {SALE_PLATFORMS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row2">
          <label>
            Price for one
            <input type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
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
        <div className="row2">
          <label>
            Fees, all together
            <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={fees} onChange={(e) => setFees(e.target.value)} />
          </label>
          <label>
            Postage you paid
            <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={postage} onChange={(e) => setPostage(e.target.value)} />
          </label>
        </div>
        <div className="row2">
          <label>
            Date sold
            <input type="date" value={soldOn} max={todayIso()} onChange={(e) => setSoldOn(e.target.value)} />
          </label>
          <label>
            Note
            <input type="text" maxLength={300} placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={logSale} onChange={(e) => setLogSale(e.target.checked)} />
          <span>Count it towards this card's value (as a logged sale)</span>
        </label>
      </div>
      <div className="sell-result" aria-live="polite">
        {takings !== null && (
          <>
            <span>
              Takings <b>{format(takings, currency)}</b>
            </span>
            {costs !== null && costs > 0 && <span>− costs {format(costs, currency)}</span>}
            {paidEach !== null && <span>− paid {format(paidEach * quantity, currency)}</span>}
            {profit !== null && (
              <span className={profit >= 0 ? 'sealed-gain' : 'sealed-loss'}>
                = profit <b>{profit < 0 ? '−' : ''}{money(Math.abs(profit), currency)}</b>
              </span>
            )}
          </>
        )}
      </div>
      <p className="faint small">
        {last ? 'These are your last copies, so this entry leaves the collection.' : `${item.quantity - quantity} stay in the collection.`} You can undo
        a sale from the sales history.
      </p>
    </Sheet>
  );
}
