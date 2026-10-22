// Changing a binder: its name, page size, and what goes in the pockets — which cards, in which
// printing, how many copies of each (9 of some Shuckles, 18 of others) and in what order.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_COPIES, POCKET_LAYOUTS, POCKET_SIZES, colourOf, type BinderColour, type Pockets } from '../../../shared/binders.ts';
import { VARIANTS } from '../../../shared/grading.ts';
import { cardNumberText } from '../../../shared/links.ts';
import { fixPrinting, printingOrder } from '../../../shared/printings.ts';
import type { Binder, BinderCard } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { ColourPicker } from '../components/ColourPicker.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconBack, IconSearch, IconTrash } from '../components/Icons.tsx';
import { api } from '../lib/api.ts';
import { printingNote, printingsOf, promosOf } from '../lib/binders.ts';
import { searchCards, type CatalogCard } from '../lib/catalog.ts';
import { goBack, navigate } from '../lib/router.ts';
import { useCatalog } from '../lib/useCatalog.ts';

interface Line extends BinderCard {
  /** Stable while the list is reordered */
  key: number;
}

const clampCopies = (n: number) => Math.min(MAX_COPIES, Math.max(1, n));

export function BinderEditPage({ id }: { id: string }) {
  const { catalog } = useCatalog();
  const { toast, confirm } = useFeedback();
  const [binder, setBinder] = useState<Binder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pockets, setPockets] = useState<Pockets>(9);
  const [colour, setColour] = useState<BinderColour>('red');
  const [lines, setLines] = useState<Line[]>([]);
  const [allCopies, setAllCopies] = useState(1);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);

  useEffect(() => {
    api.binder(id).then(
      ({ binder: b }) => {
        setBinder(b);
        setName(b.name);
        setPockets(b.pockets as Pockets);
        setColour(colourOf(b));
        setLines(b.cards.map((c) => ({ ...c, key: nextKey.current++ })));
        setAllCopies(b.cards[0]?.copies ?? 1);
      },
      (err: Error) => setError(err.message),
    );
  }, [id]);

  // Printings a card doesn't come in (saved before they were known) become its main one, so saving fixes them.
  const fixed = useRef(false);
  useEffect(() => {
    if (!catalog || !binder || fixed.current) return;
    fixed.current = true;
    setLines((ls) => ls.map((l) => ({ ...l, variant: fixPrinting(l.variant, catalog.byId.get(l.cardId)?.variants) })));
  }, [catalog, binder]);

  const results = useMemo(() => (catalog && query.trim() ? searchCards(catalog, query, 12) : []), [catalog, query]);

  const update = (key: number, patch: Partial<BinderCard>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (index: number, by: number) =>
    setLines((ls) => {
      const next = [...ls];
      const [line] = next.splice(index, 1);
      next.splice(index + by, 0, line);
      return next;
    });
  const add = (card: CatalogCard) =>
    setLines((ls) => [
      ...ls,
      { cardId: card.id, variant: printingsOf(card, false, catalog ? promosOf(catalog, [card]) : undefined)[0], copies: allCopies, key: nextKey.current++ },
    ]);

  async function save() {
    setSaving(true);
    try {
      await api.updateBinder(id, { name: name.trim(), pockets, colour, cards: lines.map(({ key: _, ...c }) => c) });
      toast('Binder saved');
      navigate(`/binder/${encodeURIComponent(id)}`, true);
    } catch (err) {
      toast((err as Error).message, 'error');
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${binder?.name}?`,
      body: 'The binder goes, but every card stays in the collection.',
      confirmText: 'Delete binder',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteBinder(id);
      toast('Binder deleted');
      navigate('/binders', true);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

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

  const total = lines.reduce((n, l) => n + l.copies, 0);
  let at = 0; // pockets before the current line

  return (
    <div className="page narrow">
      <button className="back" onClick={() => goBack(`/binder/${encodeURIComponent(id)}`)}>
        <IconBack /> {binder.name}
      </button>
      <h1>Edit binder</h1>
      <div className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <fieldset>
          <legend>Colour</legend>
          <ColourPicker value={colour} onChange={setColour} />
        </fieldset>
        <fieldset>
          <legend>Pockets per page</legend>
          <div className="segmented">
            {POCKET_SIZES.map((n) => (
              <button type="button" key={n} className={pockets === n ? 'on' : ''} aria-pressed={pockets === n} onClick={() => setPockets(n)}>
                {n} <span className="faint small">({POCKET_LAYOUTS[n]}×{n / POCKET_LAYOUTS[n]})</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Copies of each card
          <div className="all-copies">
            <Stepper value={allCopies} onChange={setAllCopies} label="Copies of each card" />
            <button
              type="button"
              className="btn small"
              disabled={!lines.length}
              onClick={() => setLines((ls) => ls.map((l) => ({ ...l, copies: allCopies })))}
            >
              Set all to {allCopies}
            </button>
          </div>
          <span className="faint small">Cards you add get this many. Change single cards below.</span>
        </label>
      </div>

      <h2>Add cards</h2>
      <div className="search">
        <IconSearch />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Card name, set or number — e.g. “shuckle vivid”"
          aria-label="Find a card to add"
        />
      </div>
      {results.length > 0 && (
        <ul className="scan-list add-results">
          {results.map((card) => (
            <li key={card.id} className="scan-entry">
              <CardImage base={card.image} name={card.name} setId={card.set.id} number={card.number} />
              <div className="scan-entry-info">
                <div className="scan-entry-top">
                  <span className="scan-entry-name">{card.name}</span>
                  <button type="button" className="btn small primary" onClick={() => add(card)}>
                    Add ×{allCopies}
                  </button>
                </div>
                <div className="muted small">
                  {card.set.name} · #{cardNumberText(card.number, card.set.official)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>
        In this binder <span className="faint small">{`${lines.length} cards · ${total} pockets · ${Math.ceil(total / pockets)} pages`}</span>
      </h2>
      {!lines.length && <p className="muted">Nothing yet: add cards above.</p>}
      <ol className="scan-list">
        {lines.map((line, i) => {
          const card = catalog?.byId.get(line.cardId);
          const start = at;
          at += line.copies;
          const printings: string[] = card?.variants?.length ? printingOrder(card.variants) : [...VARIANTS];
          if (!printings.includes(line.variant)) printings.push(line.variant);
          return (
            <li key={line.key} className="scan-entry">
              <CardImage base={card?.image} name={card?.name ?? line.cardId} setId={card?.set.id} number={card?.number} />
              <div className="scan-entry-info">
                <div className="scan-entry-top">
                  <span className="scan-entry-name">{card?.name ?? line.cardId}</span>
                  <span className="faint small nowrap">
                    page {Math.floor(start / pockets) + 1}, pocket {(start % pockets) + 1}
                  </span>
                </div>
                <div className="muted small">{card ? `${card.set.name} · #${cardNumberText(card.number, card.set.official)}` : ''}</div>
                <div className="scan-entry-actions wrap">
                  <select value={line.variant} onChange={(e) => update(line.key, { variant: e.target.value })} aria-label={`Printing of ${card?.name ?? line.cardId}`}>
                    {printings.map((v) => (
                      <option key={v} value={v}>
                        {printingNote(v)}
                      </option>
                    ))}
                  </select>
                  <Stepper value={line.copies} onChange={(copies) => update(line.key, { copies })} label={`Copies of ${card?.name ?? line.cardId}`} />
                  <button type="button" className="icon-btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="icon-btn small" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn small"
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                    aria-label={`Take ${card?.name ?? line.cardId} out`}
                  >
                    <IconTrash width={18} height={18} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="list-foot">
        <button className="btn danger-outline" onClick={remove} disabled={saving}>
          Delete
        </button>
        <button className="btn primary" onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save binder'}
        </button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper small">
      <button type="button" onClick={() => onChange(clampCopies(value - 1))} disabled={value <= 1} aria-label={`Fewer: ${label}`}>
        −
      </button>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(clampCopies(parseInt(e.target.value, 10) || 1))} aria-label={label} />
      <button type="button" onClick={() => onChange(clampCopies(value + 1))} disabled={value >= MAX_COPIES} aria-label={`More: ${label}`}>
        +
      </button>
    </div>
  );
}
