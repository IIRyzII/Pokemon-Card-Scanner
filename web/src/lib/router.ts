// Tiny hash router (#/path) — works on GitHub Pages without server rewrites.
// Going back (or forward) to a page returns to where it was scrolled; a new page starts at the top.

import { useCallback, useEffect, useState } from 'react';

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function current(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = hash.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return {
    path,
    parts: path.split('/').filter(Boolean).map((p) => decodeURIComponent(p)),
    query: new URLSearchParams(queryPart),
  };
}

type PageState = { scrollY?: number } | null;

/** Records how far the page is scrolled in its history entry, for coming back to it. */
function saveScroll() {
  history.replaceState({ ...(history.state as object | null), scrollY: Math.round(window.scrollY) }, '');
}

/** Scrolls back to `y` once the page has drawn tall enough (lists can take a moment), for up to a second. */
function restoreScroll(y: number) {
  const until = performance.now() + 1000;
  const attempt = () => {
    window.scrollTo(0, y);
    const reachable = document.documentElement.scrollHeight - window.innerHeight >= y - 2;
    if (!reachable && performance.now() < until) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(() => requestAnimationFrame(attempt));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    history.scrollRestoration = 'manual'; // the browser's own would jump before the page is drawn
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(saveScroll, 120);
    };
    // Also just before a tap leaves the page, in case it scrolled a moment ago.
    const onTap = () => {
      window.clearTimeout(timer);
      saveScroll();
    };
    const onChange = () => {
      window.clearTimeout(timer);
      setRoute(current());
      const y = (history.state as PageState)?.scrollY;
      if (typeof y === 'number' && y > 0) restoreScroll(y);
      else window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', onTap, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onTap, true);
    };
  }, []);
  return route;
}

/**
 * A page setting kept in its address (#/add?q=shuckle), so going back to the page brings it back.
 * Changing it rewrites the address without making a new history step.
 */
export function useQueryParam(name: string, fallback = ''): [string, (value: string) => void] {
  const [value, setValue] = useState(() => current().query.get(name) ?? fallback);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      const { path, query } = current();
      if (next && next !== fallback) query.set(name, next);
      else query.delete(name);
      const q = query.toString();
      history.replaceState(history.state, '', `#${path}${q ? `?${q}` : ''}`);
    },
    [name, fallback],
  );
  return [value, set];
}

export function navigate(to: string, replace = false) {
  const url = `#${to}`;
  if (replace) {
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = to;
  }
}

/** href for a route, encoding each dynamic segment. */
export const href = (...segments: string[]) => `#/${segments.map((s) => encodeURIComponent(s)).join('/')}`;

export function goBack(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback);
}
