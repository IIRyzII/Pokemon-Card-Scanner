import { href } from '../lib/router.ts';
import { IconBinder, IconSets } from './Icons.tsx';

/** Switches between the catalog's sets and your own binders. */
export function SetsTabs({ on }: { on: 'sets' | 'binders' }) {
  return (
    <nav className="segmented full tabs" aria-label="Sets and binders">
      <a className={on === 'sets' ? 'on' : ''} href={href('sets')} aria-current={on === 'sets' ? 'page' : undefined}>
        <IconSets width={18} height={18} /> Sets
      </a>
      <a className={on === 'binders' ? 'on' : ''} href={href('binders')} aria-current={on === 'binders' ? 'page' : undefined}>
        <IconBinder width={18} height={18} /> Binders
      </a>
    </nav>
  );
}
