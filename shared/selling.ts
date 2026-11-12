// Selling cards from the collection: where they're sold, and a ready-made listing title and
// description for a copy.

import { CONDITION_LABELS, gradeText, type Condition } from './grading.ts';
import { languageLabel } from './languages.ts';
import { cardNumberText } from './links.ts';
import { printingLabel } from './printings.ts';

/** Where cards are usually sold (the app offers these; anything else is "Other"). */
export const SALE_PLATFORMS = ['eBay', 'Vinted', 'Cardmarket', 'Facebook', 'In person', 'Other'] as const;

/** eBay's limit on a listing's title */
export const TITLE_LIMIT = 80;

/** What a listing says about one copy: the card, and the copy's printing, language and condition or grade. */
export interface ListingCopy {
  name: string;
  setName: string;
  number: string;
  setTotal: number | null;
  rarity: string | null;
  artist?: string | null;
  variant: string;
  language: string | null;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
  condition: string | null;
  certNumber?: string | null;
}

/** The printing worth naming in a title: not a plain regular card's. */
const printingWords = (variant: string) => (variant === 'normal' ? '' : printingLabel(variant).replace(/ · .*$/, ''));

/**
 * A listing title, at most TITLE_LIMIT characters: the card's name and number, its set, its
 * printing and language, "Pokemon Card" and its grade or condition. Words are left out from the
 * least useful when it's too long.
 */
export function listingTitle(c: ListingCopy): string {
  const number = cardNumberText(c.number, c.setTotal);
  const graded = c.grader !== 'RAW';
  const parts: { text: string; keep: number }[] = [
    { text: c.name, keep: 0 },
    { text: number, keep: 0 },
    { text: c.setName, keep: 2 },
    { text: printingWords(c.variant), keep: 1 },
    { text: c.language && c.language !== 'en' ? languageLabel(c.language) : '', keep: 1 },
    { text: 'Pokemon', keep: 3 },
    { text: 'Card', keep: 4 },
    { text: graded ? gradeText(c.grader, c.grade, c.gradeLabel) : (c.condition ?? ''), keep: 0 },
  ].filter((p) => p.text);
  const join = (ps: typeof parts) => ps.map((p) => p.text).join(' ');
  // Drop the least useful words first (the highest `keep`), until it fits.
  let kept = parts;
  for (const level of [4, 3, 2, 1]) {
    if (join(kept).length <= TITLE_LIMIT) break;
    kept = kept.filter((p) => p.keep !== level);
  }
  const title = join(kept);
  return title.length <= TITLE_LIMIT ? title : `${title.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

/** A plain-text listing description: the facts about the card and this copy, one to a line. */
export function listingDescription(c: ListingCopy): string {
  const graded = c.grader !== 'RAW';
  const lines = [
    `${c.name}, ${c.setName}, ${cardNumberText(c.number, c.setTotal)}`,
    c.rarity && `Rarity: ${c.rarity}`,
    `Printing: ${c.variant === 'normal' ? 'Regular' : printingLabel(c.variant)}`,
    `Language: ${languageLabel(c.language)}`,
    graded
      ? `Graded: ${gradeText(c.grader, c.grade, c.gradeLabel)}${c.certNumber ? ` (certificate ${c.certNumber})` : ''}`
      : c.condition && `Condition: ${CONDITION_LABELS[c.condition as Condition] ?? c.condition}`,
    c.artist && `Illustrator: ${c.artist}`,
  ];
  return lines.filter(Boolean).join('\n');
}
