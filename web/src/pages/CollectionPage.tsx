import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { languageLabel } from '../../../shared/languages.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { CollectionItem } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { ItemTile } from '../components/CardTile.tsx';
import { useCombineDuplicates } from '../components/CombineDuplicates.tsx';
import { IconPlus, IconRefresh, IconSearch } from '../components/Icons.tsx';
import { canonicalArtist, normName, type Catalog } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { copiesByCard, spares } from '../lib/dupes.ts';
import { relativeTime } from '../lib/format.ts';
import { href, useQueryParam } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';

const SORTS = {
  recent: 'Recently added',
  value: 'Value: high → low',
  valueAsc: 'Value: low → high',
  copies: 'Copies: most → least',
  name: 'Name A–Z',
  set: 'Set & number',
  artist: 'Artist A–Z',
} as const;

const FILTERS = { all: 'All', raw: 'Raw', graded: 'Graded', dupes: 'Dupes' } as const;
type Filter = keyof typeof FILTERS;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type SortKey = keyof typeof SORTS;
const SORT_KEY = 'pokevault.sort';

function readSort(): SortKey {
  try {
    const s = localStorage.getItem(SORT_KEY);
    if (s && s in SORTS) return s as SortKey;
  } catch {
    // ignore
  }
  return 'recent';
}

const numberValue = (n: string) => {
  const m = n.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
};

function sortItems(
  items: CollectionItem[],
  sort: SortKey,
  catalog: Catalog | null,
  convert: (amount: number | null, from: string) => number | null,
  copies: Map<string, number>,
): CollectionItem[] {
  const total = (i: CollectionItem) => (convert(i.value, i.valueCurrency ?? 'USD') ?? -1) * i.quantity;
  const setDate = (i: CollectionItem) => catalog?.sets.find((s) => s.id === i.setId)?.date ?? '';
  const artist = (i: CollectionItem) => canonicalArtist(catalog, i.artist) ?? '￿';
  const held = (i: CollectionItem) => copies.get(i.cardId) ?? 0;
  const list = [...items];
  switch (sort) {
    case 'value':
      return list.sort((a, b) => total(b) - total(a));
    case 'valueAsc':
      return list.sort((a, b) => total(a) - total(b));
    case 'copies':
      // Each card's entries together, its biggest first.
      return list.sort(
        (a, b) =>
          held(b) - held(a) || a.name.localeCompare(b.name) || a.cardId.localeCompare(b.cardId) || b.quantity - a.quantity,
      );
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name) || setDate(a).localeCompare(setDate(b)));
    case 'set':
      return list.sort(
        (a, b) => setDate(a).localeCompare(setDate(b)) || a.setName.localeCompare(b.setName) || numberValue(a.number) - numberValue(b.number),
      );
    case 'artist':
      return list.sort((a, b) => artist(a).localeCompare(artist(b)) || a.name.localeCompare(b.name));
    default:
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function CollectionPage() {
  const { data, error, loading, reload, pricesUpdating } = useCollection();
  const { user } = useSession();
  const { catalog } = useCatalog();
  const { format, convert, currency } = useCurrency();
  // Search and filter kept in the address, so coming back from a card shows the same cards.
  const [query, setQuery] = useQueryParam('q');
  const [shown, setShown] = useQueryParam('show', 'all');
  const filter: Filter = shown in FILTERS ? (shown as Filter) : 'all';
  const setFilter = (f: Filter) => setShown(f);
  const [sort, setSortState] = useState<SortKey>(readSort);
  const canEdit = hasRole(user?.role, 'editor');
  const copies = useMemo(() => copiesByCard(data?.items ?? []), [data]);
  const duplicates = useCombineDuplicates();
  const unitValue = useCallback((i: CollectionItem) => convert(i.value, i.valueCurrency ?? 'USD'), [convert]);

  const setSort = (s: SortKey) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // ignore
    }
  };

  const items = useMemo(() => {
    const q = normName(query);
    const filtered = (data?.items ?? []).filter((i) => {
      if (filter === 'raw' && i.grader !== 'RAW') return false;
      if (filter === 'graded' && i.grader === 'RAW') return false;
      if (filter === 'dupes' && (copies.get(i.cardId) ?? 0) < 2) return false;
      if (!q) return true;
      const hay = normName(
        `${i.name} ${i.setName} ${i.number} ${canonicalArtist(catalog, i.artist) ?? ''} ${i.grader === 'RAW' ? '' : `${i.grader} ${i.grade}`} ${i.language && i.language !== 'en' ? languageLabel(i.language) : ''} ${i.notes ?? ''}`,
      );
      return q.split(' ').every((w) => hay.includes(w));
    });
    return sortItems(filtered, sort, catalog, convert, copies);
  }, [data, query, filter, sort, catalog, convert, copies]);

  // Sorted by artist: a header per artist. By copies: a header per card held more than once.
  const groups = useMemo(() => {
    if (sort !== 'artist' && sort !== 'copies') return null;
    const out: { key: string; head: ReactNode; count: string; items: CollectionItem[]; value: number }[] = [];
    for (const item of items) {
      let key: string;
      let head: ReactNode;
      if (sort === 'artist') {
        key = canonicalArtist(catalog, item.artist) ?? 'Unknown artist';
        head = <a href={href('artist', key)}>🖌 {key}</a>;
      } else if ((copies.get(item.cardId) ?? 0) > 1) {
        key = item.cardId;
        head = (
          <>
            <a href={href('card', item.cardId)}>{item.name}</a>
            <span className="faint small">
              {item.setName} · #{cardNumberText(item.number, item.setTotal)}
            </span>
          </>
        );
      } else {
        key = 'singles';
        head = 'One copy';
      }
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, head, count: '', items: [], value: 0 };
        out.push(g);
      }
      g.items.push(item);
      g.value += (unitValue(item) ?? 0) * item.quantity;
    }
    for (const g of out) {
      const n = g.items.reduce((sum, i) => sum + i.quantity, 0);
      g.count = sort === 'artist' ? String(g.items.length) : g.key === 'singles' ? plural(n, 'card') : `×${n}`;
    }
    return out;
  }, [items, sort, catalog, unitValue, copies]);

  const dupes = useMemo(() => (filter === 'dupes' ? spares(items, unitValue) : null), [filter, items, unitValue]);

  const s = data?.summary;

  return (
    <div className="page">
      <section className="summary">
        <div>
          <div className="muted small">Collection value</div>
          <div className="big-value">{s ? format(s.totalValue, s.currency) : '—'}</div>
          {pricesUpdating ? (
            <div className="prices-status faint small">
              <IconRefresh className="spin" /> Updating prices…
            </div>
          ) : (
            s?.pricesUpdatedAt && <div className="prices-status faint small">Prices updated {relativeTime(s.pricesUpdatedAt)}</div>
          )}
        </div>
        <div className="stats">
          <div>
            <b>{s?.cards ?? 0}</b>
            <span>cards</span>
          </div>
          <div>
            <b>{s?.graded ?? 0}</b>
            <span>graded</span>
          </div>
          <div>
            <b>{s?.items ?? 0}</b>
            <span>entries</span>
          </div>
        </div>
        {s && s.unpriced > 0 && <div className="faint small">{s.unpriced} without a price yet</div>}
      </section>

      {canEdit && duplicates.into > 0 && (
        <div className="note merge-note">
          <span>
            {duplicates.entries} entries are copies of the same card with the same details, from before copies were counted together.
          </span>
          <button className="btn small primary" onClick={duplicates.combine} disabled={duplicates.merging}>
            {duplicates.merging ? 'Combining…' : `Combine into ${duplicates.into}`}
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            type="search"
            placeholder="Search your cards, sets, artists…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search collection"
          />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <div className="segmented small" role="group" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTERS[f]}
            </button>
          ))}
        </div>
      </div>

      {dupes && dupes.cards > 0 && (
        <p className="muted small dupes-summary">
          {plural(dupes.cards, 'card')} you have more than one of:{' '}
          <strong>{plural(dupes.copies, 'spare copy', 'spare copies')}</strong>, worth about {format(dupes.value, currency)}{' '}
          (keeping your most valuable copy of each).
        </p>
      )}

      {error && (
        <p className="error">
          {error}{' '}
          <button className="link" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {loading && !data && <div className="spinner" aria-label="Loading" />}

      {data && data.items.length === 0 && (
        <div className="empty">
          <h2>No cards yet</h2>
          {canEdit ? (
            <>
              <p className="muted">Scan a card with your camera or search by name to add your first one.</p>
              <a className="btn primary" href={href('add', 'scan')}>
                Scan a card
              </a>{' '}
              <a className="btn" href={href('add')}>
                Search by name
              </a>
            </>
          ) : (
            <p className="muted">Cards added by editors will show up here.</p>
          )}
        </div>
      )}
      {data && data.items.length > 0 && items.length === 0 && (
        <p className="muted center">
          {filter === 'dupes' && !query.trim() ? 'No duplicates: you have one copy of every card.' : 'No cards match.'}
        </p>
      )}

      {groups
        ? groups.map((g) => (
            <section key={g.key} className="group">
              <h2 className="group-head">
                {g.head}
                <span className="group-count small">
                  {g.count} · {format(g.value, currency)}
                </span>
              </h2>
              <div className="grid">
                {g.items.map((item) => (
                  <ItemTile key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))
        : items.length > 0 && (
            <div className="grid">
              {items.map((item) => (
                <ItemTile key={item.id} item={item} />
              ))}
            </div>
          )}

      {canEdit && data && (
        <p className="center small">
          <a href={href('trash')} className="faint">
            Recently removed
          </a>
        </p>
      )}
      {canEdit && (
        <a className="fab" href={href('add')} aria-label="Add a card">
          <IconPlus />
        </a>
      )}
    </div>
  );
}
