// The binders standing on a bookshelf, each spine in its colour (thicker for more pages). Hovering
// over one, or tapping it, shows its name, how full it is and what it's worth; tapping it again
// (or "Open binder") opens it.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BINDER_COLOURS, colourOf } from '../../../shared/binders.ts';
import type { Binder } from '../../../shared/types.ts';
import { percentFilled, type BinderStats } from '../lib/binders.ts';
import { href, navigate } from '../lib/router.ts';
import { ProgressBar } from './ProgressBar.tsx';

export interface ShelfItem {
  binder: Binder;
  stats: BinderStats;
}

interface Props {
  items: ShelfItem[];
  /** Money in the viewer's currency */
  money: (v: number) => string;
}

interface Shown {
  id: string;
  /** Tapped or clicked (stays until tapped elsewhere), rather than hovered */
  pinned: boolean;
  left: number;
  top: number;
  width: number;
  /** Where the arrow points, from the card's left edge */
  arrow: number;
  below: boolean;
}

const POP_WIDTH = 260;
const meter = (s: BinderStats) => (s.pockets ? (100 * s.filled) / s.pockets : 0);

/** Spine size: thicker the more pages, taller for 12-pocket binders. */
function spineStyle(b: Binder, s: BinderStats): CSSProperties {
  const width = Math.round(Math.min(78, Math.max(34, 28 + s.pages * 1.2)));
  const height = b.pockets === 12 ? 176 : b.pockets === 4 ? 146 : 162;
  return { width, height, '--c': BINDER_COLOURS[colourOf(b)].hex } as CSSProperties;
}

/** Smaller lettering for long names, so more of them fits down the spine. */
const labelSize = (name: string) => (name.length > 16 ? '0.6rem' : name.length > 11 ? '0.66rem' : undefined);

export function BinderShelf({ items, money }: Props) {
  const shelf = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  // A hovered card stays a moment after the pointer leaves the spine, so it can reach "Open binder".
  const keep = () => window.clearTimeout(hideTimer.current);
  const hideSoon = () => {
    keep();
    hideTimer.current = window.setTimeout(() => setShown((s) => (s?.pinned ? s : null)), 250);
  };
  useEffect(() => keep, []);

  function show(id: string, spine: HTMLElement, pinned: boolean) {
    keep();
    const box = shelf.current?.getBoundingClientRect();
    if (!box) return;
    const r = spine.getBoundingClientRect();
    const width = Math.min(POP_WIDTH, box.width - 16);
    const centre = r.left - box.left + r.width / 2;
    const left = Math.min(Math.max(8, centre - width / 2), box.width - width - 8);
    const below = r.top < 230; // no room above it on screen: show it over the shelf below
    setShown({ id, pinned, left, width, arrow: centre - left, top: below ? r.bottom - box.top + 10 : r.top - box.top - 10, below });
  }

  // Tapping anywhere else, or Escape, puts it away.
  useEffect(() => {
    if (!shown?.pinned) return;
    const away = (e: PointerEvent) => !shelf.current?.contains(e.target as Node) && setShown(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShown(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [shown?.pinned]);

  const active = shown && items.find((i) => i.binder.id === shown.id);

  return (
    <div className="shelf" ref={shelf}>
      <div className="shelf-books">
        {items.map(({ binder: b, stats: s }) => (
          <div key={b.id} className="spine-slot">
            <button
              type="button"
              className={`spine${shown?.id === b.id ? ' up' : ''}${colourOf(b) === 'white' ? ' light' : ''}`}
              style={spineStyle(b, s)}
              aria-label={`${b.name}: ${s.filled} of ${s.pockets} pockets filled`}
              aria-expanded={shown?.id === b.id}
              onMouseEnter={(e) => !shown?.pinned && show(b.id, e.currentTarget, false)}
              onMouseLeave={hideSoon}
              onFocus={(e) => !shown?.pinned && show(b.id, e.currentTarget, false)}
              onBlur={() => !shown?.pinned && setShown(null)}
              onClick={(e) => {
                if (shown?.id === b.id && shown.pinned) navigate(`/binder/${encodeURIComponent(b.id)}`);
                else show(b.id, e.currentTarget, true);
              }}
              onDoubleClick={() => navigate(`/binder/${encodeURIComponent(b.id)}`)}
            >
              <span className="spine-label" style={{ fontSize: labelSize(b.name) }}>
                {b.name}
              </span>
              <span className="spine-meter" aria-hidden="true">
                <span style={{ width: `${meter(s)}%` }} />
              </span>
              <span className="spine-hole" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {active && shown && (
        <div
          className={`shelf-pop${shown.below ? ' below' : ''}`}
          style={{ left: shown.left, top: shown.top, width: shown.width, '--arrow': `${shown.arrow}px` } as CSSProperties}
          role="status"
          onMouseEnter={keep}
          onMouseLeave={hideSoon}
        >
          <div className="shelf-pop-name">
            <span className="swatch" style={{ background: BINDER_COLOURS[colourOf(active.binder)].hex }} />
            {active.binder.name}
          </div>
          <div className="faint small">
            {active.binder.pockets}-pocket pages · {active.stats.pages} {active.stats.pages === 1 ? 'page' : 'pages'}
          </div>
          <ProgressBar value={active.stats.filled} max={active.stats.pockets} label={`${active.binder.name}: pockets filled`} />
          <div className="small">
            <b>
              {active.stats.filled}/{active.stats.pockets}
            </b>{' '}
            pockets filled · <b>{percentFilled(active.stats)}</b>
          </div>
          {active.stats.value !== null && (
            <div className="small">
              {active.stats.filled ? (
                <>
                  Worth about <b>{money(active.stats.value)}</b>
                </>
              ) : (
                'Nothing in it yet'
              )}
              {active.stats.toComplete ? <span className="faint"> · {money(active.stats.toComplete)} to complete</span> : null}
            </div>
          )}
          <a className="btn small primary" href={href('binder', active.binder.id)}>
            Open binder
          </a>
        </div>
      )}
    </div>
  );
}
