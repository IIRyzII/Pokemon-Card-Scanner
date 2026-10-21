// The scan list: check the cards scanned from a stack, then add them all to the collection at once.

import { useEffect, useRef, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import type { CardDetailResponse, ItemFields } from '../../../shared/types.ts';
import { valueItem } from '../../../shared/values.ts';
import { CardImage } from '../components/CardImage.tsx';
import { gradeBadge, variantLabel } from '../components/CardTile.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconScan, IconTrash } from '../components/Icons.tsx';
import { ItemForm } from '../components/ItemForm.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { api } from '../lib/api.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { money } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';
import { copiesIn, scanList, setStackMode, useScanList, type ListEntry } from '../lib/scanList.ts';

const FETCH_AT_ONCE = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ScanListPanel() {
  const list = useScanList();
  const { ctx } = useCurrency();
  const { reload, ownedByCard } = useCollection();
  const { toast, confirm } = useFeedback();
  const [details, setDetails] = useState<ReadonlyMap<string, CardDetailResponse>>(new Map());
  const [unreachable, setUnreachable] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const asked = useRef(new Set<string>());

  // Each card's printings (the catalog doesn't know them) and prices, from our API, a few at a time.
  useEffect(() => {
    const ids = [...new Set(list.map((e) => e.card.id))].filter((id) => !asked.current.has(id));
    if (!ids.length) return;
    ids.forEach((id) => asked.current.add(id));
    const next = async (): Promise<void> => {
      const id = ids.shift();
      if (!id) return;
      try {
        const detail = await api.card(id);
        scanList.setVariants(id, detail.card.variants);
        setDetails((m) => new Map(m).set(id, detail));
      } catch {
        setUnreachable((s) => new Set(s).add(id));
      }
      return next();
    };
    for (let i = 0; i < FETCH_AT_ONCE; i++) void next();
  }, [list, unreachable]);

  function retry() {
    unreachable.forEach((id) => asked.current.delete(id));
    setUnreachable(new Set());
  }

  /** Estimated value of an entry's copies, in the home currency; null without a price. */
  function valueOf(e: ListEntry): number | null {
    const d = details.get(e.card.id);
    const unit = d ? valueItem(e.fields, d.prices, d.sales, ctx).unit : null;
    return unit === null ? null : unit * e.fields.quantity;
  }

  const copies = copiesIn(list);
  const values = list.map(valueOf).filter((v): v is number => v !== null);
  const total = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const checking = list.some((e) => e.variants === null && !unreachable.has(e.card.id));
  const busy = adding !== null;
  const editingEntry = editing ? list.find((e) => e.key === editing) : undefined;

  async function addAll() {
    const entries = scanList.get();
    const n = copiesIn(entries);
    const ok = await confirm({
      title: `Add ${plural(n, 'card')} to the collection?`,
      body: `${plural(entries.length, 'different card')}${total !== null ? `, worth about ${money(total, ctx.currency)}` : ''}.`,
      confirmText: `✓ Add ${plural(n, 'card')}`,
    });
    if (!ok) return;
    setAdding({ done: 0, total: entries.length });
    let added = 0;
    let failed = 0;
    for (const e of entries) {
      try {
        await api.addItem({ cardId: e.card.id, ...e.fields });
        scanList.remove(e.key);
        added += e.fields.quantity;
      } catch (err) {
        failed++;
        scanList.update(e.key, { error: (err as Error).message });
      }
      setAdding((a) => a && { ...a, done: a.done + 1 });
    }
    setAdding(null);
    await reload();
    if (failed) {
      toast(`${added ? `Added ${plural(added, 'card')}. ` : ''}${plural(failed, 'card')} couldn't be added — see the list.`, 'error');
    } else {
      toast(`Added ${plural(added, 'card')} to the collection`);
      navigate('/');
    }
  }

  async function clearList() {
    const ok = await confirm({
      title: 'Clear the list?',
      body: `Takes all ${plural(copies, 'card')} out of the list. Nothing in the collection changes.`,
      confirmText: 'Clear the list',
      danger: true,
    });
    if (ok) scanList.clear();
  }

  if (!list.length) {
    return (
      <div className="empty">
        <p>No cards in the list.</p>
        <p className="muted small">
          To scan a stack, choose “Stack of cards” on the Scan tab and show the cards one after another. Each card found goes in this
          list, then you add them all to the collection at once.
        </p>
        <a className="btn primary" href={href('add', 'scan')} onClick={() => setStackMode(true)}>
          <IconScan width={18} height={18} /> Scan a stack
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="list-head">
        <div>
          <div>
            <strong>{plural(copies, 'card')}</strong> ready to add
          </div>
          <div className="muted small">
            {checking ? 'Checking printings and prices…' : total !== null ? `Worth about ${money(total, ctx.currency)}` : 'No prices yet'}
          </div>
        </div>
        <a className="btn small" href={href('add', 'scan')} onClick={() => setStackMode(true)}>
          <IconScan width={16} height={16} /> Scan more
        </a>
      </div>
      <p className="faint small">
        Nothing is saved until you add the list. Each card starts as raw, Near Mint, in its first printing; tap Edit to change that.
      </p>
      {unreachable.size > 0 && (
        <p className="error small">
          Couldn't check {plural(unreachable.size, 'card')} with the PokéVault API.{' '}
          <button type="button" className="link" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      <ul className="scan-list">
        {list.map((e) => (
          <Entry
            key={e.key}
            entry={e}
            value={valueOf(e)}
            currency={ctx.currency}
            owned={ownedCount(ownedByCard.get(e.card.id))}
            checking={e.variants === null && !unreachable.has(e.card.id)}
            busy={busy}
            onEdit={() => setEditing(e.key)}
          />
        ))}
      </ul>
      <div className="list-foot">
        <button className="btn ghost" onClick={clearList} disabled={busy}>
          Clear
        </button>
        <button className="btn primary" onClick={addAll} disabled={busy || checking}>
          {adding
            ? `Adding ${Math.min(adding.done + 1, adding.total)} of ${adding.total}…`
            : checking
              ? 'Checking printings…'
              : `Add ${plural(copies, 'card')} to the collection`}
        </button>
      </div>
      {editingEntry && <EditEntry entry={editingEntry} onClose={() => setEditing(null)} />}
    </>
  );
}

interface EntryProps {
  entry: ListEntry;
  value: number | null;
  currency: string;
  owned: number;
  checking: boolean;
  busy: boolean;
  onEdit: () => void;
}

function Entry({ entry, value, currency, owned, checking, busy, onEdit }: EntryProps) {
  const { card, fields } = entry;
  const setQuantity = (q: number) => scanList.update(entry.key, { fields: { ...fields, quantity: Math.min(999, Math.max(1, q)) } });
  return (
    <li className={`scan-entry${entry.error ? ' failed' : ''}`}>
      <a href={href('card', card.id)} tabIndex={-1} aria-hidden="true">
        <CardImage base={card.image} name={card.name} setId={card.setId} number={card.number} />
      </a>
      <div className="scan-entry-info">
        <div className="scan-entry-top">
          <a className="scan-entry-name" href={href('card', card.id)}>
            {card.name}
          </a>
          <span className="scan-entry-value">{value !== null ? money(value, currency) : '—'}</span>
        </div>
        <div className="muted small">
          {card.setName} · #{cardNumberText(card.number, card.setTotal)}
        </div>
        <div className="small">
          {checking ? <span className="faint">Checking printings…</span> : variantLabel(fields.variant)} · {gradeBadge(fields)}
          {owned > 0 && <span className="faint"> · you have {owned}</span>}
        </div>
        {entry.error && <p className="error small">{entry.error}</p>}
        <div className="scan-entry-actions">
          <div className="stepper small">
            <button
              type="button"
              onClick={() => setQuantity(fields.quantity - 1)}
              disabled={busy || fields.quantity <= 1}
              aria-label={`Fewer ${card.name}`}
            >
              −
            </button>
            <input
              inputMode="numeric"
              value={fields.quantity}
              onChange={(ev) => setQuantity(parseInt(ev.target.value, 10) || 1)}
              disabled={busy}
              aria-label={`Quantity of ${card.name}`}
            />
            <button type="button" onClick={() => setQuantity(fields.quantity + 1)} disabled={busy} aria-label={`More ${card.name}`}>
              +
            </button>
          </div>
          <button type="button" className="btn small" onClick={onEdit} disabled={busy}>
            Edit
          </button>
          <button
            type="button"
            className="icon-btn small"
            onClick={() => scanList.remove(entry.key)}
            disabled={busy}
            aria-label={`Remove ${card.name} from the list`}
          >
            <IconTrash width={18} height={18} />
          </button>
        </div>
      </div>
    </li>
  );
}

/** Printing, grade, purchase details and notes of one entry, the same form as adding a single card. */
function EditEntry({ entry, onClose }: { entry: ListEntry; onClose: () => void }) {
  const { card } = entry;
  const [fields, setFields] = useState<ItemFields>(entry.fields);
  function save() {
    scanList.update(entry.key, { fields, error: undefined });
    onClose();
  }
  return (
    <Sheet
      title="Edit card"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Done
          </button>
        </>
      }
    >
      <div className="mini-card">
        <CardImage base={card.image} name={card.name} setId={card.setId} number={card.number} />
        <div>
          <strong>{card.name}</strong>
          <div className="muted">
            {card.setName} · #{cardNumberText(card.number, card.setTotal)}
          </div>
        </div>
      </div>
      <ItemForm value={fields} onChange={setFields} variants={entry.variants ?? [entry.fields.variant]} />
    </Sheet>
  );
}
