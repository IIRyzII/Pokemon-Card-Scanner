import { useMemo, useState } from 'react';
import type { CollectionItem } from '../../../shared/types.ts';
import { hasRole } from '../../../shared/types.ts';
import { ItemTile } from '../components/CardTile.tsx';
import { IconPlus, IconRefresh, IconSearch } from '../components/Icons.tsx';
import { canonicalArtist, normName, type Catalog } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { relativeTime } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';

const SORTS = {
  recent: 'Recently added',
  value: 'Value: high → low',
  valueAsc: 'Value: low → high',
  name: 'Name A–Z',
  set: 'Set & number',
  artist: 'Artist A–Z',
} as const;
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
): CollectionItem[] {
  const total = (i: CollectionItem) => (convert(i.value, i.valueCurrency ?? 'USD') ?? -1) * i.quantity;
  const setDate = (i: CollectionItem) => catalog?.sets.find((s) => s.id === i.setId)?.date ?? '';
  const artist = (i: CollectionItem) => canonicalArtist(catalog, i.artist) ?? '￿';
  const list = [...items];
  switch (sort) {
    case 'value':
      return list.sort((a, b) => total(b) - total(a));
    case 'valueAsc':
      return list.sort((a, b) => total(a) - total(b));
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
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<SortKey>(readSort);
  const [filter, setFilter] = useState<'all' | 'raw' | 'graded'>('all');
  const canEdit = hasRole(user?.role, 'editor');

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
      if (!q) return true;
      const hay = normName(
        `${i.name} ${i.setName} ${i.number} ${canonicalArtist(catalog, i.artist) ?? ''} ${i.grader === 'RAW' ? '' : `${i.grader} ${i.grade}`} ${i.notes ?? ''}`,
      );
      return q.split(' ').every((w) => hay.includes(w));
    });
    return sortItems(filtered, sort, catalog, convert);
  }, [data, query, filter, sort, catalog, convert]);

  // When sorted by artist, show a header per artist.
  const groups = useMemo(() => {
    if (sort !== 'artist') return null;
    const out: { artist: string; items: CollectionItem[]; value: number }[] = [];
    for (const item of items) {
      const a = canonicalArtist(catalog, item.artist) ?? 'Unknown artist';
      let g = out[out.length - 1];
      if (!g || g.artist !== a) out.push((g = { artist: a, items: [], value: 0 }));
      g.items.push(item);
      g.value += (convert(item.value, item.valueCurrency ?? 'USD') ?? 0) * item.quantity;
    }
    return out;
  }, [items, sort, catalog, convert]);

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
        <div className="segmented small">
          {(['all', 'raw', 'graded'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'raw' ? 'Raw' : 'Graded'}
            </button>
          ))}
        </div>
      </div>

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
      {data && data.items.length > 0 && items.length === 0 && <p className="muted center">No cards match.</p>}

      {groups
        ? groups.map((g) => (
            <section key={g.artist} className="group">
              <h2 className="group-head">
                <a href={href('artist', g.artist)}>🖌 {g.artist}</a>
                <span className="faint small">
                  {g.items.length} · {format(g.value, currency)}
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
