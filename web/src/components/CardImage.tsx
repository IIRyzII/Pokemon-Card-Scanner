import { useState } from 'react';
import { imageUrl } from '../lib/catalog.ts';

interface Props {
  base: string | null | undefined;
  name: string;
  subtitle?: string;
  quality?: 'low' | 'high';
  className?: string;
  eager?: boolean;
}

/** A card picture, or a card-shaped placeholder when no scan of the card exists. */
export function CardImage({ base, name, subtitle, quality = 'low', className = '', eager = false }: Props) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(base, quality);
  if (!src || failed) {
    return (
      <div className={`card-img placeholder ${className}`} role="img" aria-label={name}>
        <span>{name}</span>
        {subtitle && <small>{subtitle}</small>}
        <small className="faint">No image available</small>
      </div>
    );
  }
  return (
    <img
      className={`card-img ${className}`}
      src={src}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
