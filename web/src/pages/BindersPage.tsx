// Your real binders, each with how full it is, and making a new one from a set or a Pokémon.

import { useEffect, useMemo, useState } from 'react';
import { MAX_COPIES, POCKET_LAYOUTS, POCKET_SIZES, type Pockets } from '../../../shared/binders.ts';
import type { Binder } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { IconPlus } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { SetsTabs } from '../components/SetsTabs.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { api } from '../lib/api.ts';
import { binderCards, ownedPrintings, pocketsOf, pokemonCardsOf, setCardsOf } from '../lib/binders.ts';
import type { Catalog, CatalogCard } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { href, navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "9-pocket pages · 30 pages (15 sheets)" */
export function layoutText(pockets: number, total: number): string {
  const pages = Math.ceil(total / pockets);
  return `${pockets}-pocket pages · ${plural(pages, 'page')} (${plural(Math.ceil(pages / 2), 'sheet')})`;
}

export function BindersPage() {
  const { user } = useSession();
  const { data } = useCollection();
  const [binders, setBinders] = useState<Binder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canEdit = hasRole(user?.role, 'editor');
  const owned = useMemo(() => ownedPrintings(data?.items ?? []), [data]);

  useEffect(() => {
    api.binders().then(
      (r) => setBinders(r.binders),
      (err: Error) => setError(err.message),
    );
  }, []);

  return (
    <div className="page">
      <SetsTabs on="binders" />
      <div className="list-head">
        <p className="muted small">
          Your real binders, page by page: the cards you have are in colour, the ones still to find are greyed out, so you know what goes
          in every pocket.
        </p>
        {canEdit && (
          <button className="btn primary small" onClick={() => setCreating(true)}>
            <IconPlus width={18} height={18} /> New binder
          </button>
        )}
      </div>
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
      <ul className="set-list">
        {binders?.map((b) => {
          const pockets = pocketsOf(b.cards, owned);
          const filled = pockets.filter((p) => p.filled).length;
          return (
            <li key={b.id}>
              <a className="binder-row" href={href('binder', b.id)}>
                <span className="set-info">
                  <span className="set-name">{b.name}</span>
                  <span className="faint small">{layoutText(b.pockets, pockets.length)}</span>
                  <ProgressBar value={filled} max={pockets.length} label={`${b.name}: ${filled} of ${pockets.length} pockets filled`} />
                </span>
                <span className="binder-count">
                  <b>
                    {filled}/{pockets.length}
                  </b>
                  <span className="faint small">{pockets.length ? Math.floor((100 * filled) / pockets.length) : 0}%</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {creating && <NewBinder onClose={() => setCreating(false)} />}
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

function NewBinder({ onClose }: { onClose: () => void }) {
  const { catalog } = useCatalog();
  const [kind, setKind] = useState<Kind>('set');
  const [setId, setSetId] = useState('');
  const [pokemon, setPokemon] = useState('');
  const [every, setEvery] = useState(false);
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
  const cards = useMemo(() => binderCards(picked, every, copies), [picked, every, copies]);
  const total = cards.reduce((n, c) => n + c.copies, 0);
  const set = catalog?.sets.find((s) => s.id === setId);
  const suggested =
    kind === 'set' && set ? `${set.name}${every ? ' master set' : ''}` : kind === 'pokemon' && pokemon.trim() ? titleCase(pokemon) : '';
  const shownName = name ?? suggested;
  const ready = shownName.trim() && (kind === 'empty' || cards.length > 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { binder } = await api.createBinder({ name: shownName.trim(), pockets, cards });
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
                <button type="button" className={!every ? 'on' : ''} aria-pressed={!every} onClick={() => setEvery(false)}>
                  One of each card
                </button>
                <button type="button" className={every ? 'on' : ''} aria-pressed={every} onClick={() => setEvery(true)}>
                  Every printing
                </button>
              </div>
              <p className="faint small">
                {every
                  ? 'A master set: each card in every printing it comes in (regular, reverse holo, holo…), side by side.'
                  : 'Each card in its main printing (regular, or holo for holo rares).'}
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
