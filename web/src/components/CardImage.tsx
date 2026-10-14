import { useEffect, useState } from 'react';
import { imageUrl } from '../lib/catalog.ts';

interface Props {
  base: string | null | undefined;
  name: string;
  subtitle?: string;
  quality?: 'low' | 'high';
  className?: string;
  eager?: boolean;
  /** Used for the second image source when TCGdex has no scan of the card */
  setId?: string;
  number?: string;
}

/** pokemontcg.io shares many set ids with TCGdex (e.g. Trainer Gallery "swsh11tg/TG03"). */
const fallbackUrl = (setId?: string, number?: string, quality: 'low' | 'high' = 'low') =>
  setId && number
    ? `https://images.pokemontcg.io/${encodeURIComponent(setId)}/${encodeURIComponent(number)}${quality === 'high' ? '_hires' : ''}.png`
    : null;

/** A card picture (TCGdex, then pokemontcg.io), or a card-shaped placeholder when neither has one. */
export function CardImage({ base, name, subtitle, quality = 'low', className = '', eager = false, setId, number }: Props) {
  const sources = [imageUrl(base, quality), fallbackUrl(setId, number, quality)].filter((s): s is string => !!s);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [base, setId, number]);
  const src = sources[attempt];

  if (!src) {
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
      key={src}
      className={`card-img ${className}`}
      src={src}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
