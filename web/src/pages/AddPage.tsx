import { Suspense, lazy, useDeferredValue, useMemo } from 'react';
import { CatalogTile } from '../components/CardTile.tsx';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { IconList, IconScan, IconSearch } from '../components/Icons.tsx';
import { searchCards } from '../lib/catalog.ts';
import { ownedCount, useCollection } from '../lib/collection.tsx';
import { href, useQueryParam } from '../lib/router.ts';
import { copiesIn, useScanList } from '../lib/scanList.ts';
import { useCatalog } from '../lib/useCatalog.ts';
import { ScanListPanel } from './ScanListPanel.tsx';

// The scanner (and its OCR engine) only downloads when the Scan tab is opened.
const ScanPanel = lazy(() => import('./ScanPanel.tsx').then((m) => ({ default: m.ScanPanel })));

/** The last search, so the Search tab comes back to it from Scan or List. */
let lastSearch = '';

export function AddPage({ tab }: { tab: 'search' | 'scan' | 'list' }) {
  const inList = copiesIn(useScanList());
  return (
    <div className="page">
      <div className="segmented full tabs">
        <a className={tab === 'search' ? 'on' : ''} href={lastSearch ? `${href('add')}?q=${encodeURIComponent(lastSearch)}` : href('add')}>
          <IconSearch width={18} height={18} /> Search
        </a>
        <a className={tab === 'scan' ? 'on' : ''} href={href('add', 'scan')}>
          <IconScan width={18} height={18} /> Scan
        </a>
        {(inList > 0 || tab === 'list') && (
          <a className={tab === 'list' ? 'on' : ''} href={href('add', 'list')}>
            <IconList width={18} height={18} /> List
            {inList > 0 && <span className="tab-count">{inList}</span>}
          </a>
        )}
      </div>
      {tab === 'scan' ? (
        <ErrorBoundary fallback={(error) => <ScannerFailed error={error} />}>
          <Suspense fallback={<div className="spinner" aria-label="Loading scanner" />}>
            <ScanPanel />
          </Suspense>
        </ErrorBoundary>
      ) : tab === 'list' ? (
        <ScanListPanel />
      ) : (
        <SearchPanel />
      )}
    </div>
  );
}

/** The scanner failed to load or crashed: say so (with the browser's reason) instead of a blank page. */
function ScannerFailed({ error }: { error: Error }) {
  return (
    <div className="empty">
      <p>The scanner couldn't start on this phone. Reloading usually fixes it after an app update.</p>
      <p className="faint small">{error.message}</p>
      <button className="btn primary" onClick={() => location.reload()}>
        Reload
      </button>{' '}
      <a className="btn" href={href('add')}>
        Search instead
      </a>
    </div>
  );
}

function SearchPanel() {
  const { catalog, error } = useCatalog();
  const { ownedByCard } = useCollection();
  // Kept in the address (#/add?q=shuckle), so coming back from a card shows the same results.
  const [query, setQueryParam] = useQueryParam('q');
  const setQuery = (q: string) => {
    lastSearch = q.trim() ? q : '';
    setQueryParam(q);
  };
  const deferred = useDeferredValue(query);
  const results = useMemo(() => (catalog ? searchCards(catalog, deferred, 90) : []), [catalog, deferred]);

  return (
    <>
      <div className="search big">
        <IconSearch />
        <input
          type="search"
          autoFocus
          placeholder="Card name, set or number — e.g. “charizard 4/102”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search all cards"
        />
      </div>
      {error && <p className="error">{error}</p>}
      {!catalog && !error && <div className="spinner" aria-label="Loading card catalog" />}
      {catalog && !query.trim() && (
        <div className="tips">
          <p className="muted">Search {catalog.cards.length.toLocaleString()} cards from {catalog.sets.length} sets. Try:</p>
          <div className="link-row">
            {['charizard 4/102', 'pikachu 151', 'umbreon vmax', 'TG05/TG30', 'lugia neo genesis'].map((ex) => (
              <button key={ex} className="chip" onClick={() => setQuery(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
      {catalog && query.trim() && results.length === 0 && <p className="muted center">No cards found. Check the spelling or try fewer words.</p>}
      <div className="grid">
        {results.map((card) => (
          <CatalogTile key={card.id} card={card} owned={ownedCount(ownedByCard.get(card.id))} />
        ))}
      </div>
    </>
  );
}
