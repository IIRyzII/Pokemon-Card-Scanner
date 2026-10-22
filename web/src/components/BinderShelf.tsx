// The binders standing on a bookshelf, each spine in its colour (thicker for more pages). Hovering
// over one, or tapping it, shows its name, how full it is and what it's worth; tapping it again
// (or "Open binder") opens it. Editors can drag them into another order: with a mouse any time, by
// touch while arranging (so dragging doesn't fight scrolling), or with the arrow keys while arranging.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as KeyEvent, type PointerEvent as PointerEv } from 'react';
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
  /** Puts the binders in a new order (every id, left to right); left out, they can't be moved */
  onReorder?: (ids: string[]) => void;
  /** Arranging: touch drags too, the arrow keys move the focused binder, and tapping doesn't open them */
  arranging?: boolean;
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  /** Where on the spine it was picked up */
  grabX: number;
  grabY: number;
  moved: boolean;
  /** The pointer's last place */
  lastX?: number;
  lastY?: number;
}

/** Pointer movement before a press becomes a drag (so a click is still a click). */
const DRAG_FROM = 6;

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

export function BinderShelf({ items, money, onReorder, arranging = false }: Props) {
  const shelf = useRef<HTMLDivElement>(null);
  const books = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  // ---- dragging into order ----
  const drag = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  /** The order while a binder is being dragged (else the items' own) */
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<{ id: string; x: number; y: number } | null>(null);
  const ids = order ?? items.map((i) => i.binder.id);
  const byId = new Map(items.map((i) => [i.binder.id, i]));
  // For the pointer listeners, which outlive a render.
  const latest = useRef({ ids, order, items, onReorder });
  latest.current = { ids, order, items, onReorder };

  const slotOf = (id: string) => books.current?.querySelector<HTMLElement>(`[data-binder="${CSS.escape(id)}"]`) ?? null;

  /** Where a binder's slot stands on screen, leaving out its slide to there (that's still under way). */
  function settled(el: HTMLElement) {
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const left = p.left + parent.clientLeft + el.offsetLeft;
    const top = p.top + parent.clientTop + el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  }

  function moved(e: PointerEvent, d: Drag) {
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_FROM) return;
      d.moved = true;
      setShown(null);
    }
    const { ids: now } = latest.current;
    // Where it would go: in front of the binder under the pointer, or after it past its middle.
    const others = now.filter((id) => id !== d.id);
    let at = -1;
    for (let i = 0; i < others.length; i++) {
      const el = slotOf(others[i]);
      if (!el) continue;
      const r = settled(el);
      if (e.clientY < r.top || e.clientY > r.bottom) continue;
      if (e.clientX < r.left + r.width / 2) {
        at = i;
        break;
      }
      at = i + 1; // past this one, on the same shelf
    }
    if (at < 0) {
      // Not level with any binder: before the first one on a lower shelf, else last.
      const below = others.findIndex((id) => {
        const el = slotOf(id);
        return !!el && settled(el).top > e.clientY;
      });
      at = below >= 0 ? below : others.length;
    }
    const next = [...others.slice(0, at), d.id, ...others.slice(at)];
    if (!latest.current.order || next.join() !== now.join()) setOrder(next);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    follow(d);
  }

  /** The lifted spine stays under the pointer, wherever its slot has moved to. */
  function follow(d: Drag) {
    const slot = slotOf(d.id);
    const spine = slot?.querySelector<HTMLElement>('.spine');
    if (!slot || !spine || d.lastX === undefined || d.lastY === undefined) return;
    const rest = settled(slot);
    const restLeft = rest.left + (rest.width - spine.offsetWidth) / 2;
    const restTop = rest.bottom - spine.offsetHeight;
    setDragged({ id: d.id, x: d.lastX - d.grabX - restLeft, y: d.lastY - d.grabY - restTop });
  }

  function pressed(e: PointerEv<HTMLButtonElement>, id: string) {
    if (!onReorder || e.button !== 0 || (e.pointerType === 'touch' && !arranging)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const d: Drag = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, moved: false };
    drag.current = d;
    // Followed on the window: the spine moves about the page as the others make room for it.
    const onMove = (ev: PointerEvent) => ev.pointerId === d.pointerId && moved(ev, d);
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      drag.current = null;
      if (!d.moved) return;
      // The click that may follow isn't a tap on a binder.
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      const { order: final, items: shelfNow, onReorder: reorder } = latest.current;
      setDragged(null);
      setOrder(null);
      if (ev.type === 'pointerup' && final && final.join() !== shelfNow.map((i) => i.binder.id).join()) reorder?.(final);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  // Once the others have made room, the lifted spine is put back under the pointer.
  useLayoutEffect(() => {
    if (drag.current?.moved) follow(drag.current);
  }, [order]); // (follow reads the slots as they are now)

  /** The arrow keys while arranging: one place along. */
  function keyed(e: KeyEvent<HTMLButtonElement>, id: string) {
    if (!arranging || !onReorder || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const now = items.map((i) => i.binder.id);
    const i = now.indexOf(id);
    const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
    if (j < 0 || j >= now.length) return;
    [now[i], now[j]] = [now[j], now[i]];
    onReorder(now);
  }

  // The others slide to their new places (rather than jumping) as the order changes.
  const placed = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const before = placed.current;
    const after = new Map<string, { left: number; top: number }>();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const id of ids) {
      const el = slotOf(id);
      if (!el) continue;
      const r = settled(el);
      after.set(id, r);
      const was = before.get(id);
      if (!was || still || id === dragged?.id) continue;
      const dx = was.left - r.left;
      const dy = was.top - r.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
    }
    placed.current = after;
  });

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

  useEffect(() => {
    if (arranging) setShown(null);
  }, [arranging]);

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
    <div className={`shelf${arranging ? ' arranging' : ''}${dragged ? ' dragging' : ''}`} ref={shelf}>
      <div className="shelf-books" ref={books}>
        {ids.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          const { binder: b, stats: s } = item;
          const lifted = dragged?.id === b.id;
          const move = lifted ? { '--dx': `${dragged.x}px`, '--dy': `${dragged.y}px` } : {};
          return (
            <div key={b.id} className="spine-slot" data-binder={b.id}>
              <button
                type="button"
                className={`spine${shown?.id === b.id ? ' up' : ''}${colourOf(b) === 'white' ? ' light' : ''}${lifted ? ' lifted' : ''}`}
                style={{ ...spineStyle(b, s), ...move } as CSSProperties}
                aria-label={`${b.name}: ${s.filled} of ${s.pockets} pockets filled${arranging ? '. Move it with the left and right arrow keys.' : ''}`}
                aria-expanded={arranging ? undefined : shown?.id === b.id}
                onMouseEnter={(e) => !arranging && !drag.current && !shown?.pinned && show(b.id, e.currentTarget, false)}
                onMouseLeave={hideSoon}
                onFocus={(e) => !arranging && !shown?.pinned && show(b.id, e.currentTarget, false)}
                onBlur={() => !shown?.pinned && setShown(null)}
                onPointerDown={(e) => pressed(e, b.id)}
                onKeyDown={(e) => keyed(e, b.id)}
                onClick={(e) => {
                  if (justDragged.current) {
                    justDragged.current = false;
                    return;
                  }
                  if (arranging) return;
                  if (shown?.id === b.id && shown.pinned) navigate(`/binder/${encodeURIComponent(b.id)}`);
                  else show(b.id, e.currentTarget, true);
                }}
                onDoubleClick={() => !arranging && navigate(`/binder/${encodeURIComponent(b.id)}`)}
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
          );
        })}
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
