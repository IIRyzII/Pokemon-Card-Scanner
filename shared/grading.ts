// Grading companies, grades, conditions and card variants shared by the web
// app and the API, plus the mapping from a grade to a PriceCharting price field.

export const GRADERS = ['RAW', 'PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'OTHER'] as const;
export type Grader = (typeof GRADERS)[number];

export const GRADER_LABELS: Record<Grader, string> = {
  RAW: 'Raw (ungraded)',
  PSA: 'PSA',
  BGS: 'Beckett (BGS)',
  CGC: 'CGC',
  SGC: 'SGC',
  TAG: 'TAG',
  ACE: 'ACE',
  OTHER: 'Other grader',
};

export const GRADES = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1] as const;

/** Special 10s that PriceCharting prices separately. */
export const GRADE_LABELS: Partial<Record<Grader, string[]>> = {
  BGS: ['Black Label'],
  CGC: ['Pristine'],
};

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

/** Variant keys match TCGdex's `variants` object. */
export const VARIANTS = ['normal', 'holo', 'reverse', 'firstEdition', 'wPromo'] as const;
export type Variant = (typeof VARIANTS)[number];
export const VARIANT_LABELS: Record<Variant, string> = {
  normal: 'Normal',
  holo: 'Holo',
  reverse: 'Reverse Holo',
  firstEdition: '1st Edition',
  wPromo: 'W Promo stamp',
};

export const isGrader = (v: unknown): v is Grader => typeof v === 'string' && (GRADERS as readonly string[]).includes(v);
export const isVariant = (v: unknown): v is Variant => typeof v === 'string' && (VARIANTS as readonly string[]).includes(v);
export const isCondition = (v: unknown): v is Condition =>
  typeof v === 'string' && (CONDITIONS as readonly string[]).includes(v);
export const isGrade = (v: unknown): v is number => typeof v === 'number' && (GRADES as readonly number[]).includes(v);

export function gradeText(grader: string, grade: number | null | undefined, label?: string | null): string {
  if (grader === 'RAW') return 'Raw';
  const name = grader === 'OTHER' ? 'Graded' : grader;
  return [name, grade ?? '', label ?? ''].filter((p) => p !== '').join(' ');
}

/**
 * Our short keys for graded price points (used for storage and display).
 * PriceCharting's "Grade 9" etc. are grader-agnostic; its 10s are per grader.
 */
export const PRICE_GRADE_KEYS = [
  'ungraded',
  'g1',
  'g2',
  'g3',
  'g4',
  'g5',
  'g6',
  'g7',
  'g8',
  'g9',
  'g9.5',
  'psa10',
  'bgs10',
  'bgs10black',
  'cgc10',
  'cgc10pristine',
  'sgc10',
  'tag10',
  'ace10',
] as const;
export type PriceGradeKey = (typeof PRICE_GRADE_KEYS)[number];

export const PRICE_GRADE_LABELS: Record<PriceGradeKey, string> = {
  ungraded: 'Ungraded',
  g1: 'Grade 1',
  g2: 'Grade 2',
  g3: 'Grade 3',
  g4: 'Grade 4',
  g5: 'Grade 5',
  g6: 'Grade 6',
  g7: 'Grade 7',
  g8: 'Grade 8',
  g9: 'Grade 9',
  'g9.5': 'Grade 9.5',
  psa10: 'PSA 10',
  bgs10: 'BGS 10',
  bgs10black: 'BGS 10 Black Label',
  cgc10: 'CGC 10',
  cgc10pristine: 'CGC 10 Pristine',
  sgc10: 'SGC 10',
  tag10: 'TAG 10',
  ace10: 'ACE 10',
};

/** PriceCharting API field (values in pennies) for each of our grade keys. */
export const PRICECHARTING_FIELDS: Record<PriceGradeKey, string> = {
  ungraded: 'loose-price',
  g1: 'condition-9-price',
  g2: 'condition-10-price',
  g3: 'condition-13-price',
  g4: 'condition-14-price',
  g5: 'condition-15-price',
  g6: 'condition-16-price',
  g7: 'cib-price',
  g8: 'new-price',
  g9: 'graded-price',
  'g9.5': 'box-only-price',
  psa10: 'manual-only-price',
  bgs10: 'bgs-10-price',
  bgs10black: 'condition-20-price',
  cgc10: 'condition-17-price',
  cgc10pristine: 'condition-19-price',
  sgc10: 'condition-18-price',
  tag10: 'condition-21-price',
  ace10: 'condition-22-price',
};

/** Which graded price point best represents a copy with this grade. */
export function priceGradeKey(grader: string, grade: number | null | undefined, label?: string | null): PriceGradeKey | null {
  if (grader === 'RAW') return 'ungraded';
  if (grade == null) return null;
  if (grade >= 10) {
    switch (grader) {
      case 'PSA':
        return 'psa10';
      case 'BGS':
        return label === 'Black Label' ? 'bgs10black' : 'bgs10';
      case 'CGC':
        return label === 'Pristine' ? 'cgc10pristine' : 'cgc10';
      case 'SGC':
        return 'sgc10';
      case 'TAG':
        return 'tag10';
      case 'ACE':
        return 'ace10';
      default:
        return null;
    }
  }
  if (grade >= 9.5) return 'g9.5';
  const whole = Math.floor(grade);
  return whole >= 1 ? (`g${whole}` as PriceGradeKey) : null;
}
