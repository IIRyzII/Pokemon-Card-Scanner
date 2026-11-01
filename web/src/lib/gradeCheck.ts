// The grade check's estimate: the best PSA grade a card could get, from its measured centering and
// what its owner sees of the rest (corners, edges, surface, creases), judged against PSA's own
// descriptions of each grade. It's a guide to whether a card is worth sending, not a grade: PSA
// judges the whole card by eye, including things a photo can't show.
//
// Sources, as PSA's own page couldn't be read directly:
//  - The centering limits and the leeway: PSA's grading standards as read on 4 October 2026, quoted
//    in B. Crosley, "How card centering is judged" (blakecrosley.com, 5 October 2026).
//  - The grade descriptions (corners, edges, surface, creases): a copy of PSA's standards "copied
//    from the PSA website and slightly modified" (Aussie Rules Collectables, "Item grading
//    information"), whose centering ranges agree with the above: each runs from the current limit
//    to where the leeway ends.
// The descriptions below paraphrase those; the UI links to PSA's page for its exact wording.

export const PSA_STANDARDS_URL = 'https://www.psacard.com/resources/cardgradingstandards';

export const PSA_NAMES: Readonly<Record<number, string>> = {
  10: 'Gem Mint',
  9: 'Mint',
  8: 'NM-MT',
  7: 'NM',
  6: 'EX-MT',
  5: 'EX',
  4: 'VG-EX',
  3: 'VG',
  2: 'Good',
  1.5: 'Fair',
  1: 'Poor',
};

export const psaText = (grade: number) => `PSA ${grade}${PSA_NAMES[grade] ? ` ${PSA_NAMES[grade]}` : ''}`;

export interface CenteringLimit {
  grade: number;
  /** The larger border's share of the pair at the most off-centre point, %, front and back: 55 is 55/45 */
  front: number;
  back: number;
  /**
   * The front with PSA's leeway: "A 5% leeway is given to the front centering minimum standards
   * for cards which grade PSA 7 or better", at the grader's discretion for a card with good eye
   * appeal.
   */
  leeway?: number;
}

/** PSA's centering limits, best grade first. A PSA 1 (Poor) has none. */
export const PSA_CENTERING: readonly CenteringLimit[] = [
  { grade: 10, front: 55, back: 75, leeway: 60 },
  { grade: 9, front: 60, back: 90, leeway: 65 },
  { grade: 8, front: 65, back: 90, leeway: 70 },
  { grade: 7, front: 70, back: 90, leeway: 75 },
  { grade: 6, front: 80, back: 90 },
  { grade: 5, front: 85, back: 90 },
  { grade: 4, front: 85, back: 90 },
  { grade: 3, front: 90, back: 90 },
  { grade: 2, front: 90, back: 90 },
  { grade: 1.5, front: 90, back: 90 },
];

/** A face's centering as measured: the worse of its two axes. */
export interface FaceCentering {
  /** The larger border's share, % (50–100) */
  share: number;
  /** How far out that could be either way, % */
  error: number;
}

export interface CenteringVerdict {
  /** The best grade the centering allows, as measured */
  grade: number;
  /** A better grade within PSA's front leeway, at the grader's discretion; null if none */
  leeway: number | null;
  /** The measurement is within its error of a limit: a little either way would change the grade */
  close: boolean;
  /** The face that holds the grade down, when only one does */
  limitedBy: 'front' | 'back' | null;
}

/** Ratios are written in whole numbers: 55.4/44.6 is 55/45. */
const whole = (share: number) => Math.round(share);

function bestFor(front: number | null, back: number | null, useLeeway = false): number {
  const limit = PSA_CENTERING.find(
    (l) => (front === null || whole(front) <= (useLeeway ? (l.leeway ?? l.front) : l.front)) && (back === null || whole(back) <= l.back),
  );
  return limit?.grade ?? 1;
}

/** The best grade a card's centering allows (front, back or both measured), by PSA's limits. */
export function centeringVerdict(front: FaceCentering | null, back: FaceCentering | null): CenteringVerdict | null {
  if (!front && !back) return null;
  const f = front?.share ?? null;
  const b = back?.share ?? null;
  const grade = bestFor(f, b);
  const withLeeway = f === null ? grade : bestFor(f, b, true);
  // Nudged by its error, would the measurement land on another grade?
  const nudged = [-1, 1].map((sign) => bestFor(f === null ? null : f + sign * front!.error, b === null ? null : b + sign * back!.error));
  const byFront = f === null ? 10 : bestFor(f, null);
  const byBack = b === null ? 10 : bestFor(null, b);
  return {
    grade,
    leeway: withLeeway > grade ? withLeeway : null,
    close: nudged.some((g) => g !== grade),
    limitedBy: byFront === byBack ? null : byFront < byBack ? 'front' : 'back',
  };
}

// ---------- what a photo can't judge: the owner's answers ----------

export type Aspect = 'corners' | 'edges' | 'surface' | 'creases';

export interface Choice {
  label: string;
  /** The best grade a card like this could get */
  best: number;
  /** Where that comes from: PSA's description of a grade, or our own reading of them */
  basis: string;
}

export interface Question {
  aspect: Aspect;
  title: string;
  /** How to check it */
  how: string;
  choices: readonly Choice[];
}

export const QUESTIONS: readonly Question[] = [
  {
    aspect: 'corners',
    title: 'Corners',
    how: 'Look closely at all four corners, front and back, under a bright light.',
    choices: [
      { label: 'All four perfectly sharp', best: 10, basis: 'A PSA 10 has four perfectly sharp corners.' },
      { label: 'The slightest fraying at one or two corners', best: 8, basis: 'PSA allows the slightest fraying at one or two corners at NM-MT 8.' },
      { label: 'Slight fraying on some corners', best: 7, basis: 'PSA allows slight fraying on some corners at NM 7.' },
      { label: 'Fraying spreading along a corner', best: 6, basis: 'PSA allows slightly graduated fraying at EX-MT 6.' },
      { label: 'Corners starting to round', best: 5, basis: 'PSA describes very minor rounding becoming evident at EX 5.' },
      { label: 'Rounded corners', best: 3, basis: 'PSA describes some rounding, though not extreme, at VG 3.' },
    ],
  },
  {
    aspect: 'edges',
    title: 'Edges',
    how: 'Look along all four edges, especially on the back, for white specks and nicks.',
    choices: [
      { label: 'Clean: no white specks or nicks', best: 10, basis: 'A PSA 10 is a virtually perfect card.' },
      {
        label: 'One or two tiny white specks, seen only up close',
        best: 9,
        basis: 'Our reading: a 10 is virtually perfect, and a PSA 9 may have one minor flaw.',
      },
      {
        label: 'A little whitening on several edges, seen only up close',
        best: 8,
        basis: 'Our reading: a PSA 8 looks like a 9 at first glance, with flaws on closer inspection.',
      },
      { label: 'Whitening or nicks you can see at a glance', best: 6, basis: 'PSA allows very slight notching on edges at EX-MT 6.' },
      { label: 'Chipped edges', best: 5, basis: 'PSA allows minor chipping on edges at EX 5.' },
      { label: 'Clearly worn edges', best: 3, basis: 'PSA allows noticeable wear on edges at VG 3.' },
    ],
  },
  {
    aspect: 'surface',
    title: 'Surface',
    how: 'Tilt the card under a light, front and back, to catch scratches, dents, print lines and marks.',
    choices: [
      { label: 'Clean and glossy, no marks', best: 10, basis: 'A PSA 10 has full original gloss and no staining.' },
      {
        label: 'A slight print line or printing mark',
        best: 9,
        basis: 'PSA allows a minor printing imperfection at Mint 9 (at 10, only a slight one that doesn’t spoil the card’s appeal).',
      },
      { label: 'Slight wear, seen only up close', best: 7, basis: 'PSA allows slight surface wear visible on close inspection at NM 7.' },
      { label: 'A very light scratch, seen only up close', best: 6, basis: 'PSA allows a very light scratch seen only on close inspection at EX-MT 6.' },
      { label: 'Several light scratches', best: 5, basis: 'PSA allows several light scratches visible on close inspection at EX 5.' },
      { label: 'Scuffs or scratches you can see easily', best: 4, basis: 'PSA allows light scuffing or light scratches at VG-EX 4.' },
    ],
  },
  {
    aspect: 'creases',
    title: 'Creases',
    how: 'Hold the card at an angle to a light: a crease shows as a line across the gloss.',
    choices: [
      { label: 'None', best: 10, basis: 'PSA first allows a crease at VG-EX 4.' },
      { label: 'A light crease', best: 4, basis: 'PSA allows a light crease at VG-EX 4.' },
      { label: 'A clear crease', best: 3, basis: 'PSA allows a crease at VG 3.' },
      { label: 'Several creases', best: 2, basis: 'PSA allows several creases at Good 2.' },
    ],
  },
];

export type Answers = Partial<Record<Aspect, number>>;

export interface Estimate {
  /** The best grade the card could get from what's known */
  best: number;
  /** What holds it there (nothing when it could be a 10) */
  limits: string[];
  /** Questions not answered yet: the estimate assumes nothing wrong there */
  unanswered: Aspect[];
}

/** The best PSA grade the card could get: the lowest of what its centering and each answer allow. */
export function estimateGrade(centering: CenteringVerdict | null, answers: Answers): Estimate {
  const parts: { what: string; grade: number }[] = [];
  if (centering) parts.push({ what: 'centering', grade: centering.grade });
  for (const q of QUESTIONS) {
    const choice = answers[q.aspect];
    if (choice !== undefined && q.choices[choice]) parts.push({ what: q.title.toLowerCase(), grade: q.choices[choice].best });
  }
  const best = Math.min(10, ...parts.map((p) => p.grade));
  return {
    best,
    limits: best < 10 ? parts.filter((p) => p.grade === best).map((p) => p.what) : [],
    unanswered: QUESTIONS.filter((q) => answers[q.aspect] === undefined).map((q) => q.aspect),
  };
}

// ---------- is it worth grading? ----------

export interface Outcome {
  grade: number;
  /** What a copy at that grade is worth */
  value: number | null;
  /** That, less the card's raw value and the cost of grading (when known) */
  gain: number | null;
}

/** Grades worth comparing: the best it could get and the two below it (whole grades). */
export function gradesToCompare(best: number): number[] {
  const top = Math.floor(best);
  return [top, top - 1, top - 2].filter((g) => g >= 1);
}

/** What grading could make at each grade: its value there, less the raw value and the cost. */
export function gradingOutcomes(grades: readonly number[], raw: number | null, valueAt: (grade: number) => number | null, cost: number | null): Outcome[] {
  return grades.map((grade) => {
    const value = valueAt(grade);
    const gain = value === null || raw === null ? null : Math.round((value - raw - (cost ?? 0)) * 100) / 100;
    return { grade, value, gain };
  });
}
