// Tiny hash router (#/path) — works on GitHub Pages without server rewrites.

import { useEffect, useState } from 'react';

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

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => {
      setRoute(current());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
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
