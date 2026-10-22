// Your real binders, on a shelf (or as a list) with how full each is and what it's worth, and
// making a new one from a set or a Pokémon.

import { useEffect, useMemo, useState } from 'react';
import {
  BINDER_COLOURS,
  MAX_COPIES,
  POCKET_LAYOUTS,
  POCKET_SIZES,
  colourOf,
  nextColour,
  type BinderColour,
  type Pockets,
} from '../../../shared/binders.ts';
import type { Binder } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { IconPlus } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { BinderShelf, type ShelfItem } from '../components/BinderShelf.tsx';
import { ColourPicker } from '../components/ColourPicker.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { api } from '../lib/api.ts';
import {
  allPrintingsOf,
  binderCards,
  promosOf,
  stampedPromosOf,
  type PrintingChoice,
  binderStats,
  fixBinderPrintings,
  knownPrintings,
  ownedPrintings,
  percentFilled,
  pocketsOf,
  pokemonCardsOf,
  setCardsOf,
} from '../lib/binders.ts';
import type { Catalog, CatalogCard } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { href, navigate } from '../lib/router.ts';
import { priceLookup } from '../lib/sets.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "9-pocket pages · 30 pages (15 sheets)" */
export function layoutText(pockets: number, total: number): string {
  const pages = Math.ceil(total / pockets);
  return `${pockets}-pocket pages · ${plural(pages, 'page')} (${plural(Math.ceil(pages / 2), 'sheet')})`;
}

const VIEW_KEY = 'pokevault.binderView';

function readView(): 'shelf' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'shelf';
  } catch {
    return 'shelf';
  }
}

export function BindersPage() {
  const { user } = useSession();
  const { data } = useCollection();
  const { catalog } = useCatalog();
  const prices = useMarketPrices();
  const { convert, format, currency } = useCurrency();
  const [binders, setBinders] = useState<Binder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setViewState] = useState(readView);
  const [arranging, setArranging] = useState(false);
  const { toast } = useFeedback();
  const canEdit = hasRole(user?.role, 'editor');
  const known = useMemo(() => knownPrintings(catalog), [catalog]);
  const owned = useMemo(() => ownedPrintings(data?.items ?? [], known), [data, known]);
  const money = (v: number) => format(v, currency, { round: true });

  useEffect(() => {
    api.binders().then(
      (r) => setBinders(r.binders),
      (err: Error) => setError(err.message),
    );
  }, []);

  // One copy's market price, by card id.
  const priceOf = useMemo(() => {
    if (!prices || !catalog) return null;
    const lookup = priceLookup(prices, convert);
    return (cardId: string) => {
      const card = catalog.byId.get(cardId);
      return card ? lookup(card) : null;
    };
  }, [prices, catalog, convert]);

  const items: ShelfItem[] = useMemo(
    () =>
      (binders ?? []).map((binder) => ({
        binder,
        stats: binderStats(pocketsOf(fixBinderPrintings(binder.cards, known), owned), binder.pockets, priceOf),
      })),
    [binders, owned, priceOf, known],
  );

  /** A new order on the shelf: shown at once, saved for everyone, put back if it can't be. */
  async function reorder(ids: string[]) {
    if (!binders) return;
    const before = binders;
    const byId = new Map(binders.map((b) => [b.id, b]));
    setBinders(ids.flatMap((id) => byId.get(id) ?? []));
    try {
      setBinders((await api.orderBinders(ids)).binders);
    } catch (err) {
      setBinders(before);
      toast((err as Error).message, 'error');
    }
  }

  function setView(v: 'shelf' | 'list') {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore
    }
  }

  return (
    <div className="page">
      <div className="binder-head">
        <h1>Binders</h1>
        {canEdit && (
          <button className="btn primary small" onClick={() => setCreating(true)}>
            <IconPlus width={18} height={18} /> New binder
          </button>
        )}
      </div>
      <p className="muted small">
        Your real binders, page by page: the cards you have are in colour, the ones still to find are greyed out, so you know what goes in
        every pocket.
      </p>
      {error && <p className="error">{error}</p>}
      {!binders && !error && <div className="spinner" aria-label="Loading binders" />}
      {binders?.length === 0 && (
        <div className="empty">
          <p>No binders yet.</p>
          <p className="muted small">
            Make one for a set you're completing (every Paradox Rift card in order, say), or for a Pokémon you collect (every Shuckle,
            9 copies of each).
          </p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="toolbar">
            <div className="segmented small" role="group" aria-label="Show binders as">
              <button className={view === 'shelf' ? 'on' : ''} aria-pressed={view === 'shelf'} onClick={() => setView('shelf')}>
                Shelf
              </button>
              <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
            </div>
            {view === 'shelf' && canEdit && items.length > 1 && (
              <button className={`btn small${arranging ? ' primary' : ''}`} aria-pressed={arranging} onClick={() => setArranging((a) => !a)}>
                {arranging ? 'Done' : 'Arrange'}
              </button>
            )}
            {view === 'shelf' && (
              <span className="faint small">
                {arranging
                  ? 'Drag the binders into the order you want them on the shelf (or pick one and use the arrow keys).'
                  : `Hover over a binder, or tap it, to see how full it is. Tap again to open it.${canEdit && items.length > 1 ? ' Drag one to move it (on a phone, tap Arrange first).' : ''}`}
              </span>
            )}
          </div>
          {view === 'shelf' ? (
            <BinderShelf items={items} money={money} onReorder={canEdit ? reorder : undefined} arranging={arranging} />
          ) : (
            <ul className="set-list">
              {items.map(({ binder: b, stats: s }) => (
                <li key={b.id}>
                  <a className="binder-row" href={href('binder', b.id)}>
                    <span className="swatch tall" style={{ background: BINDER_COLOURS[colourOf(b)].hex }} aria-hidden="true" />
                    <span className="set-info">
                      <span className="set-name">{b.name}</span>
                      <span className="faint small">{layoutText(b.pockets, s.pockets)}</span>
                      <ProgressBar value={s.filled} max={s.pockets} label={`${b.name}: ${s.filled} of ${s.pockets} pockets filled`} />
                    </span>
                    <span className="binder-count">
                      <b>
                        {s.filled}/{s.pockets}
                      </b>
                      <span className="faint small">{percentFilled(s)}</span>
                      {s.value !== null && <span className="faint small">{money(s.value)}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {creating && <NewBinder shelf={binders ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

type Kind = 'set' | 'pokemon' | 'empty';

const titleCase = (s: string) => s.trim().replace(/(^|\s)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Sets newest series first, for picking one. */
function setGroups(catalog: Catalog) {
  const groups = new Map<string, Catalog['sets']>();
  for (const s of [...catalog.sets].reverse()) {
    if (!catalog.bySet.get(s.id)?.length) continue;
    const key = s.serieName ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups];
}

function NewBinder({ shelf, onClose }: { shelf: Binder[]; onClose: () => void }) {
  const { catalog } = useCatalog();
  const [colour, setColour] = useState<BinderColour>(() => nextColour(shelf));
  const [kind, setKind] = useState<Kind>('set');
  const [setId, setSetId] = useState('');
  const [pokemon, setPokemon] = useState('');
  const [printings, setPrintings] = useState<PrintingChoice>('one');
  const [copies, setCopies] = useState(1);
  const [pockets, setPockets] = useState<Pockets>(9);
  const [name, setName] = useState<string | null>(null); // null: follow what's picked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sets = useMemo(() => (catalog ? setGroups(catalog) : []), [catalog]);
  const picked: CatalogCard[] = useMemo(() => {
    if (!catalog) return [];
    if (kind === 'set') return setId ? setCardsOf(catalog, setId) : [];
    if (kind === 'pokemon') return pokemonCardsOf(catalog, pokemon);
    return [];
  }, [catalog, kind, setId, pokemon]);
  // Printings only promos come in (a common's blister-pack holo): left out, or last in a grand master set.
  const promos = useMemo(() => (catalog ? promosOf(catalog, picked) : new Set<string>()), [catalog, picked]);
  // …and the set's stamped promo cards (its Build & Battle and prerelease promos), last of all.
  const stamped = useMemo(() => (catalog && kind === 'set' ? stampedPromosOf(catalog, picked) : []), [catalog, kind, picked]);
  const cards = useMemo(() => binderCards(picked, printings, copies, promos, stamped), [picked, printings, copies, promos, stamped]);
  const promoCount = picked.reduce((n, c) => n + allPrintingsOf(c).filter((v) => promos.has(`${c.id}|${v}`)).length, 0);
  const total = cards.reduce((n, c) => n + c.copies, 0);
  const set = catalog?.sets.find((s) => s.id === setId);
  const suggested =
    kind === 'set' && set
      ? `${set.name}${printings === 'master' ? ' master set' : printings === 'grand' ? ' grand master set' : ''}`
      : kind === 'pokemon' && pokemon.trim()
        ? titleCase(pokemon)
        : '';
  const shownName = name ?? suggested;
  const ready = shownName.trim() && (kind === 'empty' || cards.length > 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { binder } = await api.createBinder({ name: shownName.trim(), pockets, cards, colour });
      onClose();
      navigate(`/binder/${encodeURIComponent(binder.id)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="New binder"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!ready || busy}>
            {busy ? 'Making…' : 'Make binder'}
          </button>
        </>
      }
    >
      <div className="form">
        <fieldset>
          <legend>What goes in it?</legend>
          <div className="segmented">
            {(
              [
                ['set', 'A set'],
                ['pokemon', 'A Pokémon'],
                ['empty', 'Start empty'],
              ] as const
            ).map(([k, label]) => (
              <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {kind === 'set' && (
          <label>
            Set
            <select value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">Choose a set…</option>
              {sets.map(([series, list]) => (
                <optgroup key={series} label={series}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.date ? ` (${s.date.slice(0, 4)})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {kind === 'pokemon' && (
          <label>
            Pokémon
            <input value={pokemon} onChange={(e) => setPokemon(e.target.value)} placeholder="e.g. Shuckle" autoComplete="off" />
          </label>
        )}

        {kind !== 'empty' && (
          <>
            <fieldset>
              <legend>Printings</legend>
              <div className="segmented">
                {(
                  [
                    ['one', 'One of each'],
                    ['master', 'Master set'],
                    ['grand', 'Grand master'],
                  ] as const
                ).map(([k, label]) => (
                  <button type="button" key={k} className={printings === k ? 'on' : ''} aria-pressed={printings === k} onClick={() => setPrintings(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="faint small">
                {printings === 'one'
                  ? 'Each card in its main printing (regular, or holo for holo rares).'
                  : printings === 'master'
                    ? 'A master set: each card in every printing from the packs (regular, reverse holo, holo…), side by side. Promo printings are left out.'
                    : `A grand master set: the master set, then the promo versions at the end (cosmos holos from blister packs and boxes, stamped and theme-deck versions: ${promoCount} here), then ${stamped.length ? `the set's ${stamped.length} stamped promo cards (Build & Battle, prerelease)` : 'its stamped promo cards (none here)'}.`}
              </p>
            </fieldset>
            <label>
              Copies of each
              <div className="stepper">
                <button type="button" onClick={() => setCopies(Math.max(1, copies - 1))} aria-label="Fewer copies">
                  −
                </button>
                <input
                  inputMode="numeric"
                  value={copies}
                  onChange={(e) => setCopies(Math.min(MAX_COPIES, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  aria-label="Copies of each"
                />
                <button type="button" onClick={() => setCopies(Math.min(MAX_COPIES, copies + 1))} aria-label="More copies">
                  +
                </button>
              </div>
              <span className="faint small">You can change this for single cards afterwards (18 of some, say).</span>
            </label>
          </>
        )}

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
          Name
          <input value={shownName} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Shuckle binder" />
        </label>
        <fieldset>
          <legend>Colour</legend>
          <ColourPicker value={colour} onChange={setColour} />
        </fieldset>

        {kind !== 'empty' && (
          <p className="note">
            {picked.length
              ? `${plural(picked.length, 'card')} → ${plural(total, 'pocket')}: ${layoutText(pockets, total)}.`
              : kind === 'set'
                ? 'Choose a set to see how many pages it needs.'
                : pokemon.trim()
                  ? `No cards of “${pokemon.trim()}”. Check the spelling.`
                  : 'Type a Pokémon to find all its cards.'}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  );
}
