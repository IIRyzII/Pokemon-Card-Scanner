import { useMemo, useState } from 'react';
import { IconSearch } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { normName } from '../lib/catalog.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { href } from '../lib/router.ts';
import { percent, percentText, setLogoUrl, setProgress, type SetProgress } from '../lib/sets.ts';
import { useCatalog } from '../lib/useCatalog.ts';

type Sort = 'complete' | 'new' | 'old' | 'name';

/** Tabs at the top of the collection: your cards, or your progress through each set. */
export function CollectionTabs({ on }: { on: 'cards' | 'sets' }) {
  return (
    <div className="segmented full tabs">
      <a className={on === 'cards' ? 'on' : ''} href="#/">
        My cards
      </a>
      <a className={on === 'sets' ? 'on' : ''} href={href('sets')}>
        Sets
      </a>
    </div>
  );
}

/** Every set, with how many of its cards are in the collection. */
export function SetsPage() {
  const { catalog, error } = useCatalog();
  const { ownedByCard } = useCollection();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<Sort>('complete');

  const progress = useMemo(() => {
    if (!catalog) return [];
    const copies = new Map([...ownedByCard].map(([id, items]) => [id, ownedCount(items)]));
    return setProgress(catalog, copies);
  }, [catalog, ownedByCard]);
  const started = progress.filter((p) => p.owned > 0);
  const complete = started.filter((p) => p.owned === p.cards.length).length;
  const all = showAll || started.length === 0;

  const list = useMemo(() => {
    const q = normName(query);
    const rows = (all ? progress : started).filter((p) => !q || normName(`${p.set.name} ${p.set.serieName ?? ''} ${p.set.code ?? ''}`).includes(q));
    const date = (p: SetProgress) => p.set.date ?? '';
    return rows.sort((a, b) =>
      sort === 'name'
        ? a.set.name.localeCompare(b.set.name)
        : sort === 'old'
          ? date(a).localeCompare(date(b))
          : sort === 'new'
            ? date(b).localeCompare(date(a))
            : percent(b) - percent(a) || b.owned - a.owned || date(b).localeCompare(date(a)),
    );
  }, [progress, started, all, query, sort]);

  // Listed by release date: one heading per series, its sets in date order beneath.
  const groups = useMemo(() => {
    if (sort !== 'new' && sort !== 'old') return [{ series: null, rows: list }];
    const bySeries = new Map<string, SetProgress[]>();
    for (const p of list) {
      const key = p.set.serieName ?? 'Other';
      bySeries.set(key, [...(bySeries.get(key) ?? []), p]);
    }
    return [...bySeries].map(([series, rows]) => ({ series, rows }));
  }, [list, sort]);

  return (
    <div className="page">
      <CollectionTabs on="sets" />
      <h1>Set progress</h1>
      {catalog && (
        <p className="muted small">
          {started.length
            ? `You've started ${started.length} of ${progress.length} sets${complete ? ` and finished ${complete}` : ''}. Tap a set to see which cards you're missing.`
            : `No cards yet, so every set is at 0%. Tap a set to see all of its cards.`}
        </p>
      )}
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input type="search" placeholder="Find a set…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a set" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort sets">
          <option value="complete">Most complete</option>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="name">A–Z</option>
        </select>
        {started.length > 0 && (
          <div className="segmented small">
            <button className={!showAll ? 'on' : ''} onClick={() => setShowAll(false)}>
              Started
            </button>
            <button className={showAll ? 'on' : ''} onClick={() => setShowAll(true)}>
              All sets
            </button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!catalog && !error && <div className="spinner" aria-label="Loading sets" />}
      {catalog && list.length === 0 && <p className="muted center">No sets match.</p>}
      {groups.map((g) => (
        <section key={g.series ?? 'all'}>
          {g.series && <h2 className="set-series">{g.series}</h2>}
          <ul className="set-list">
            {g.rows.map((p) => (
              <li key={p.set.id}>
                <SetRow p={p} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SetRow({ p }: { p: SetProgress }) {
  const [noLogo, setNoLogo] = useState(false);
  const logo = noLogo ? null : setLogoUrl(p.set);
  const done = p.owned === p.cards.length;
  return (
    <a className="set-row" href={href('set', p.set.id)}>
      <span className="set-logo">
        {logo ? <img src={logo} alt="" loading="lazy" onError={() => setNoLogo(true)} /> : <span className="set-code">{p.set.code}</span>}
      </span>
      <span className="set-info">
        <span className="set-name">{p.set.name}</span>
        <span className="faint small">{[p.set.serieName, p.set.date?.slice(0, 4), p.set.code].filter(Boolean).join(' · ')}</span>
        <ProgressBar value={p.owned} max={p.cards.length} label={`${p.set.name} completion`} />
      </span>
      <span className="set-count">
        <span>
          <b>{p.owned}</b>/{p.cards.length}
        </span>
        <span className={done ? 'done small' : 'faint small'}>{done ? 'Complete ✓' : percentText(p)}</span>
      </span>
    </a>
  );
}
