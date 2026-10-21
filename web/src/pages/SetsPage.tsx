import { useMemo, useState } from 'react';
import { IconSearch } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { SetsTabs } from '../components/SetsTabs.tsx';
import { normName } from '../lib/catalog.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { shortDate } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { percent, percentText, priceLookup, setLogoUrl, setProgress, setValue, type SetProgress, type SetValue } from '../lib/sets.ts';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';

type Sort = 'complete' | 'new' | 'old' | 'value' | 'name';

interface Row extends SetProgress {
  value: SetValue | null;
}

/** Every set, with how much of it is in the collection and what it's worth. */
export function SetsPage() {
  const { catalog, error } = useCatalog();
  const { ownedByCard } = useCollection();
  const prices = useMarketPrices();
  const { convert, format, currency } = useCurrency();
  const [query, setQuery] = useState('');
  const [onlyStarted, setOnlyStarted] = useState(false);
  const [sort, setSort] = useState<Sort>('complete');

  const rows = useMemo<Row[]>(() => {
    if (!catalog) return [];
    const copies = new Map([...ownedByCard].map(([id, items]) => [id, ownedCount(items)]));
    const priceOf = priceLookup(prices, convert);
    return setProgress(catalog, copies).map((p) => ({ ...p, value: prices ? setValue(p, priceOf, (c) => copies.has(c.id)) : null }));
  }, [catalog, ownedByCard, prices, convert]);
  const started = rows.filter((p) => p.owned > 0);
  const complete = started.filter((p) => p.owned === p.cards.length).length;

  const list = useMemo(() => {
    const q = normName(query);
    const shown = (onlyStarted ? started : rows).filter((p) => !q || normName(`${p.set.name} ${p.set.serieName ?? ''} ${p.set.code ?? ''}`).includes(q));
    const date = (p: Row) => p.set.date ?? '';
    return shown.sort((a, b) =>
      sort === 'name'
        ? a.set.name.localeCompare(b.set.name)
        : sort === 'old'
          ? date(a).localeCompare(date(b))
          : sort === 'new'
            ? date(b).localeCompare(date(a))
            : sort === 'value'
              ? (b.value?.total ?? 0) - (a.value?.total ?? 0)
              : percent(b) - percent(a) || b.owned - a.owned || date(b).localeCompare(date(a)),
    );
  }, [rows, started, onlyStarted, query, sort]);

  // Listed by release date: one heading per series, its sets in date order beneath.
  const groups = useMemo(() => {
    if (sort !== 'new' && sort !== 'old') return [{ series: null, rows: list }];
    const bySeries = new Map<string, Row[]>();
    for (const p of list) {
      const key = p.set.serieName ?? 'Other';
      bySeries.set(key, [...(bySeries.get(key) ?? []), p]);
    }
    return [...bySeries].map(([series, rows]) => ({ series, rows }));
  }, [list, sort]);

  const money = (v: number) => format(v, currency, { round: true });

  return (
    <div className="page">
      <SetsTabs on="sets" />
      {catalog && (
        <p className="muted small">
          {started.length
            ? `${progressSummary(started.length, rows.length, complete)} Tap a set to see every card in it and which ones you're missing.`
            : `All ${rows.length} sets. Tap one to see every card in it — add cards and you'll see how close you are to completing each set.`}
        </p>
      )}
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input type="search" placeholder="Find a set, e.g. Paradox Rift" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a set" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort sets">
          <option value="complete">Most complete</option>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          {prices && <option value="value">Highest value</option>}
          <option value="name">A–Z</option>
        </select>
        {started.length > 0 && (
          <div className="segmented small">
            <button className={!onlyStarted ? 'on' : ''} onClick={() => setOnlyStarted(false)}>
              All sets
            </button>
            <button className={onlyStarted ? 'on' : ''} onClick={() => setOnlyStarted(true)}>
              Started
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
                <SetRow p={p} money={money} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {prices && (
        <p className="faint small center">
          Set values are market prices for one near-mint copy of each card (TCGplayer, or Cardmarket for cards TCGplayer doesn't list), updated{' '}
          {shortDate(prices.updated)}.
        </p>
      )}
    </div>
  );
}

const progressSummary = (started: number, all: number, complete: number) =>
  `You've started ${started} of ${all} sets${complete ? ` and finished ${complete}` : ''}.`;

function SetRow({ p, money }: { p: Row; money: (v: number) => string }) {
  const [noLogo, setNoLogo] = useState(false);
  const logo = noLogo ? null : setLogoUrl(p.set);
  const done = p.owned === p.cards.length;
  const v = p.value;
  return (
    <a className="set-row" href={href('set', p.set.id)}>
      <span className="set-logo">
        {logo ? <img src={logo} alt="" loading="lazy" onError={() => setNoLogo(true)} /> : <span className="set-code">{p.set.code}</span>}
      </span>
      <span className="set-info">
        <span className="set-name">{p.set.name}</span>
        <span className="faint small">{[p.set.serieName, p.set.date?.slice(0, 4), p.set.code].filter(Boolean).join(' · ')}</span>
        <ProgressBar value={p.owned} max={p.cards.length} label={`${p.set.name} completion`} />
        {v && v.priced > 0 && (
          <span className="set-value small">
            Set {money(v.total)}
            {p.owned > 0 && !done && <span className="muted"> · {money(v.missing)} to complete</span>}
          </span>
        )}
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
