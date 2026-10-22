// One card on the want list (or about to go on it): its price for the printing wanted, where it
// goes, how much it's wanted and the most you'd pay, and buying it.

import { useEffect, useMemo, useState } from 'react';
import { BINDER_COLOURS } from '../../../shared/binders.ts';
import { cardNumberText, cardmarketSearchUrl, ebayBuyUrl, ebaySoldUrl, tcgplayerUrl } from '../../../shared/links.ts';
import { fixPrinting, printingOrder } from '../../../shared/printings.ts';
import { hasRole, type CardDetailResponse } from '../../../shared/types.ts';
import { DEFAULT_PRIORITY, MAX_WANT_QUANTITY, PRIORITY_VALUES, WANT_PRIORITIES } from '../../../shared/wants.ts';
import { api } from '../lib/api.ts';
import { printingNote } from '../lib/binders.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { href } from '../lib/router.ts';
import { priceLookup } from '../lib/sets.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';
import { priceEntry, type WantEntry } from '../lib/wants.ts';
import { useWants } from '../lib/wantsContext.tsx';
import { AddToCollection } from './AddToCollection.tsx';
import { CardImage } from './CardImage.tsx';
import { useFeedback } from './feedback.tsx';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';
import { TiltCard } from './TiltCard.tsx';

export const PRIORITY_STARS: Record<number, string> = { 1: '★★★', 2: '★★', 3: '★' };

interface Props {
  cardId: string;
  /** The printing (else the one already wanted, else the card's first) */
  variant?: string;
  /** Its place on the want list, when it's on it */
  entry?: WantEntry | null;
  onClose: () => void;
}

export function WantSheet({ cardId, variant: startVariant, entry, onClose }: Props) {
  const { catalog } = useCatalog();
  const { byCard, save, remove } = useWants();
  const { ownedByCard } = useCollection();
  const prices = useMarketPrices();
  const { ctx, convert, format, currency, ebayDomain } = useCurrency();
  const { user } = useSession();
  const { toast, confirm } = useFeedback();
  const canEdit = hasRole(user?.role, 'editor');
  const card = catalog?.byId.get(cardId);
  const mine = byCard.get(cardId) ?? [];
  const printings: string[] = card?.variants?.length ? printingOrder(card.variants) : ['normal'];
  const [variant, setVariant] = useState(startVariant ?? mine[0]?.variant ?? printings[0]);
  const existing = mine.find((w) => w.variant === variant) ?? null;

  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState<number>(DEFAULT_PRIORITY);
  const [maxPrice, setMaxPrice] = useState('');
  const [note, setNote] = useState('');
  // The form shows what's saved for the printing picked (or a fresh start).
  useEffect(() => {
    const w = mine.find((x) => x.variant === variant) ?? null;
    setQuantity(w?.quantity ?? (entry?.variant === variant ? entry.wanted : 1));
    setPriority(w?.priority ?? (entry?.variant === variant ? entry.priority : DEFAULT_PRIORITY));
    const limit = w?.maxPrice != null ? convert(w.maxPrice, w.maxCurrency ?? currency) : null;
    setMaxPrice(limit != null ? String(Math.round(limit * 100) / 100) : '');
    setNote(w?.note ?? '');
  }, [variant, existing?.id]); // (not on every render's fresh `mine` list)

  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  useEffect(() => {
    let alive = true;
    api.card(cardId).then(
      (d) => alive && setDetail(d),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [cardId]);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const usual = useMemo(() => (card ? priceLookup(prices, convert)(card) : null), [card, prices, convert]);
  const price = priceEntry({ variant }, detail?.prices, ctx, usual);
  const limit = maxPrice.trim() === '' ? null : Number(maxPrice);
  const deal = limit !== null && price.each !== null && price.each <= limit + 0.005;
  const owned = (ownedByCard.get(cardId) ?? [])
    .filter((i) => fixPrinting(i.variant, card?.variants) === variant)
    .reduce((n, i) => n + i.quantity, 0);
  const places = entry?.variant === variant ? entry.binders : [];

  if (adding && detail) {
    return (
      <AddToCollection
        card={detail.card}
        detail={detail}
        variant={variant}
        onClose={() => setAdding(false)}
        onAdded={() => {
          toast(`Got it! ${detail.card.name} is in the collection`);
          onClose();
        }}
      />
    );
  }

  const name = card?.name ?? detail?.card.name ?? cardId;
  const number = card ? cardNumberText(card.number, card.set.official) : '';
  const ref = { name, number: card?.number ?? '', setName: card?.set.name ?? '', setTotal: card?.set.official };

  async function onSave() {
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return toast('The most you’d pay must be a price', 'error');
    setBusy(true);
    try {
      await save({ cardId, variant, quantity, priority, maxPrice: limit, maxCurrency: limit === null ? null : currency, note: note.trim() || null });
      toast(existing ? 'Saved' : `${name} is on the want list`);
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!existing) return;
    const ok = await confirm({
      title: 'Take it off the want list?',
      body: places.length ? `It stays on the list for ${places.map((p) => p.name).join(' and ')} until those pockets are filled.` : `${name} (${printingNote(variant)}) comes off the list.`,
      confirmText: 'Take it off',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await remove(existing.id);
      toast('Taken off the want list');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={existing ? 'On your want list' : entry ? 'Wanted for your binders' : 'Want it'}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            {existing && (
              <button className="btn danger-outline" onClick={onRemove} disabled={busy}>
                Remove
              </button>
            )}
            <button className="btn" onClick={() => setAdding(true)} disabled={!detail || busy} title="Add a copy to the collection">
              ✓ Bought it
            </button>
            <button className="btn primary" onClick={onSave} disabled={busy}>
              {existing || entry ? 'Save' : 'Add to want list'}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="want-sheet-top">
        <TiltCard className="want-sheet-card">
          <CardImage base={card?.image} name={name} quality="high" eager setId={card?.set.id} number={card?.number} />
        </TiltCard>
        <div className="want-sheet-info">
          <a className="want-sheet-name" href={href('card', cardId)}>
            {name}
          </a>
          <div className="muted small">
            {card ? (
              <>
                <a href={href('set', card.set.id)}>{card.set.name}</a> · #{number}
              </>
            ) : null}
          </div>
          <div className="want-sheet-price">
            <b>{price.each === null ? '—' : `${price.exact ? '' : '≈ '}${format(price.each, currency)}`}</b>
            <span className="faint small">
              {printingNote(variant)} · {price.detail}
            </span>
          </div>
          {deal && <span className="deal-tag inline">Deal: at or under your limit</span>}
          <div className="small">
            You have <b>{owned}</b> of this printing
          </div>
        </div>
      </div>

      {places.length > 0 && (
        <div className="want-places">
          <h3>Goes in</h3>
          <ul>
            {places.map((p) => (
              <li key={p.binderId}>
                <span className="swatch" style={{ background: BINDER_COLOURS[p.colour].hex }} aria-hidden="true" />
                <a href={href('binder', p.binderId)}>{p.name}</a>
                <span className="faint small">
                  page {p.page}, pocket {p.pocket} · needs {p.need}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit ? (
        <div className="form want-form">
          {printings.length > 1 && (
            <label>
              Printing
              <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                {printings.map((v) => (
                  <option key={v} value={v}>
                    {printingNote(v)}
                    {mine.some((w) => w.variant === v) ? ' ♥' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend>How much do you want it?</legend>
            <div className="segmented full" role="group" aria-label="Priority">
              {PRIORITY_VALUES.map((p) => (
                <button type="button" key={p} className={priority === p ? 'on' : ''} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                  <span className="stars">{PRIORITY_STARS[p]}</span> {WANT_PRIORITIES[p]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="row2">
            <label>
              Copies wanted
              <span className="stepper">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One fewer">
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_WANT_QUANTITY}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(MAX_WANT_QUANTITY, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  aria-label="Copies wanted"
                />
                <button type="button" onClick={() => setQuantity((q) => Math.min(MAX_WANT_QUANTITY, q + 1))} aria-label="One more">
                  +
                </button>
              </span>
            </label>
            <label>
              Most you’d pay ({currency})
              <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="No limit" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </label>
          </div>
          <p className="faint small">Copies you already have count towards it. At or under your limit, it shows as a deal.</p>
          <label>
            Note
            <input type="text" maxLength={300} placeholder="e.g. near mint only" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      ) : (
        existing && (
          <p className="small">
            {PRIORITY_STARS[existing.priority]} {WANT_PRIORITIES[existing.priority as 1 | 2 | 3]} · {existing.quantity} wanted
            {existing.note && <span className="faint"> · {existing.note}</span>}
          </p>
        )
      )}

      <div className="want-shop">
        <h3>Find one</h3>
        <div className="actions">
          <a className="btn small" href={cardmarketSearchUrl(ref)} target="_blank" rel="noreferrer">
            Cardmarket <IconExternal width={14} height={14} />
          </a>
          <a className="btn small" href={tcgplayerUrl(ref)} target="_blank" rel="noreferrer">
            TCGplayer <IconExternal width={14} height={14} />
          </a>
          <a className="btn small" href={ebayBuyUrl(ref, ebayDomain)} target="_blank" rel="noreferrer">
            eBay listings <IconExternal width={14} height={14} />
          </a>
          <a className="btn small" href={ebaySoldUrl(ref, 'RAW', null, null, ebayDomain)} target="_blank" rel="noreferrer">
            eBay sold <IconExternal width={14} height={14} />
          </a>
        </div>
      </div>
    </Sheet>
  );
}
