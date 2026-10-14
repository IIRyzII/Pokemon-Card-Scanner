import { CONDITION_LABELS, VARIANT_LABELS, gradeText, type Condition, type Variant } from '../../../shared/grading.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { CollectionItem } from '../../../shared/types.ts';
import type { CatalogCard } from '../lib/catalog.ts';
import { money } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { CardImage } from './CardImage.tsx';

export const variantLabel = (v: string) => VARIANT_LABELS[v as Variant] ?? v;
export const conditionLabel = (c: string | null) => (c ? (CONDITION_LABELS[c as Condition] ?? c) : '');

/** "PSA 10", "Raw · NM" */
export function gradeBadge(item: Pick<CollectionItem, 'grader' | 'grade' | 'gradeLabel' | 'condition'>): string {
  return item.grader === 'RAW' ? `Raw${item.condition ? ` · ${item.condition}` : ''}` : gradeText(item.grader, item.grade, item.gradeLabel);
}

export function ItemTile({ item, artist }: { item: CollectionItem; artist?: string | null }) {
  const graded = item.grader !== 'RAW';
  return (
    <a className="tile" href={href('item', item.id)}>
      <div className="tile-img">
        <CardImage base={item.image} name={item.name} subtitle={`${item.setName} · ${cardNumberText(item.number, item.setTotal)}`} />
        <div className="tile-badges">
          {graded && <span className="badge grade">{gradeBadge(item)}</span>}
          {item.variant !== 'normal' && item.variant !== 'holo' && <span className="badge">{variantLabel(item.variant)}</span>}
        </div>
        {item.quantity > 1 && <span className="badge qty">×{item.quantity}</span>}
      </div>
      <div className="tile-body">
        <div className="tile-name">{item.name}</div>
        <div className="tile-meta">
          {item.setName} · #{cardNumberText(item.number, item.setTotal)}
        </div>
        {artist && <div className="tile-meta faint">🖌 {artist}</div>}
        {item.value === null ? (
          <div className="tile-value none">No price yet</div>
        ) : (
          <div className="tile-value">
            {money(item.value * item.quantity)}
            {item.quantity > 1 && <small> ({money(item.value)} ea)</small>}
          </div>
        )}
      </div>
    </a>
  );
}

export function CatalogTile({ card, owned }: { card: CatalogCard; owned?: number }) {
  return (
    <a className={`tile ${owned ? 'owned' : ''}`} href={href('card', card.id)}>
      <div className="tile-img">
        <CardImage base={card.image} name={card.name} subtitle={`${card.set.name} · ${cardNumberText(card.number, card.set.official)}`} />
        {owned ? <span className="badge owned-badge">Owned ×{owned}</span> : null}
      </div>
      <div className="tile-body">
        <div className="tile-name">{card.name}</div>
        <div className="tile-meta">
          {card.set.name} · #{cardNumberText(card.number, card.set.official)}
        </div>
        {card.rarity && <div className="tile-meta faint">{card.rarity}</div>}
      </div>
    </a>
  );
}
