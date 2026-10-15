// Parses raw OCR text from the two scanned strips of a card:
//  - top strip:    stage + name + HP     → name candidates
//  - bottom strip: illustrator, set code, number/total ("025/165", "TG05/TG30", "SWSH050")

import type { ScanGuess } from '../lib/match.ts';

// Characters OCR commonly confuses with digits inside a card number.
const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', S: '5', s: '5', Z: '2', z: '2', B: '8' };
const fixDigits = (s: string) => s.replace(/[OoQDIli|!SsZzB]/g, (c) => DIGIT_FIX[c] ?? c);
const D = '[0-9OoQDIli|!SsZzB]'; // lenient digit

const NOISE_LINE = /^(evolves?\s+from|put\s+|tera\b|ability\b|rule\b)/i;
const STAGE_PREFIX = /^(basic|stage\s*[12i]{0,2}|trainer|supporter|item|stadium|pok[eé]mon\s+tool|tool|special\s+energy|energy|restored|baby|level[- ]?up)\b[\s:.-]*/i;

// Short words that really are part of card names ("Charizard ex", "Mewtwo V", "Mega Charizard X ex").
const NAME_SUFFIXES = new Set(['ex', 'EX', 'GX', 'V', 'X', 'Y', 'LV', 'δ', '☆']);

function cleanNameLine(line: string): string {
  const cleaned = line
    .replace(/evolves?\s+from.*$/i, '')
    .replace(/\bHP\s*[0-9OoIl]{2,3}\b.*$/i, '') // "HP 120" and anything after
    .replace(/\b[0-9OoIl]{2,3}\s*HP\b.*$/i, '') // "120 HP"
    .replace(/[^A-Za-zÀ-ÿ'’.\-♀♂ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop stray 1–2 letter fragments OCR picks up from symbols ("ll Pikachu", "Furret wl Xx").
  const words = cleaned.split(' ').filter(Boolean);
  const junk = (w: string) => !/[A-Za-zÀ-ÿ]/.test(w) || (w.length <= 2 && !w.includes('.') && !NAME_SUFFIXES.has(w));
  while (words.length > 1 && junk(words[0])) words.shift();
  while (words.length > 1 && junk(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ♀♂.]+$/g, '');
}

const letterCount = (s: string) => (s.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;

/**
 * Plausible card names from the top strip, best first. Each line is offered
 * with and without a leading stage/trainer banner word, because that word is
 * sometimes part of the name ("Energy Retrieval") and sometimes not ("BASIC").
 */
export function parseNameText(text: string): string[] {
  const candidates: { name: string; rank: number }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || NOISE_LINE.test(line)) continue;
    let stripped = line;
    for (let i = 0; i < 3; i++) stripped = stripped.replace(STAGE_PREFIX, '');
    const variants = [cleanNameLine(stripped), cleanNameLine(line)];
    variants.forEach((name, i) => {
      const letters = letterCount(name);
      if (letters >= 3 && name.length <= 40) candidates.push({ name, rank: letters - i * 0.5 });
    });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return [...new Set(candidates.map((c) => c.name))].slice(0, 4);
}

export interface BottomInfo {
  number: string | null;
  total: number | null;
  setCode: string | null;
  artist: string | null;
  /** Possible number/total readings when OCR dropped the slash ("4102" → 4/102). */
  alternatives?: { number: string; total: number }[];
}

/** "4102" → [{4, 102}], "025165" → [{025, 165}]; 4–6 digit runs only, years skipped. */
export function slashlessReadings(text: string): { number: string; total: number }[] {
  const out: { number: string; total: number }[] = [];
  // (No lookbehind: Safari before iOS 16.4 can't even load a file that contains one.)
  for (const m of text.matchAll(/(?:^|[^0-9A-Za-z])([0-9]{4,6})(?![0-9A-Za-z])/g)) {
    const digits = m[1];
    if (/^(19|20)\d\d$/.test(digits)) continue;
    for (let i = 1; i <= 3; i++) {
      const total = digits.slice(i);
      if (total.length < 2 || total.length > 3 || parseInt(total, 10) < 10) continue;
      out.push({ number: digits.slice(0, i), total: parseInt(total, 10) });
    }
  }
  return out;
}

export function parseBottomText(text: string): BottomInfo {
  const out: BottomInfo = { number: null, total: null, setCode: null, artist: null };
  const flat = text.replace(/\r?\n/g, ' \n ');

  const illus = text.match(/[Il1|]{1,2}lus(?:t|tr)?\.?\s*([A-Za-zÀ-ÿ0-9 .'"&-]{3,40})/i);
  if (illus) {
    const name = illus[1].replace(/\s+\d.*$/, '').replace(/\s+[A-Z]{2,4}\s+EN\b.*$/, '').trim();
    if (name.length >= 3) out.artist = name;
  }

  const code = flat.match(/\b([A-Z][A-Z0-9]{1,3})\s*[-·.]?\s*EN\b/);
  if (code && !/^(EN|HP)$/.test(code[1])) out.setCode = code[1];

  // Gallery / vault / radiant numbering: TG05/TG30, GG44/GG70, SV49/SV94, RC5/RC32, H5/H32
  const prefixed = flat.match(new RegExp(`\\b(TG|GG|SV|RC|SH|AR|RT|SL|H)\\s?(${D}{1,3})\\s?\\/\\s?(?:TG|GG|SV|RC|SH|AR|RT|SL|H)?\\s?(${D}{1,3})\\b`, 'i'));
  if (prefixed) {
    out.number = `${prefixed[1].toUpperCase()}${fixDigits(prefixed[2])}`;
    out.total = parseInt(fixDigits(prefixed[3]), 10) || null;
    return out;
  }

  // Standard "025/165" — prefer a match whose total has 2+ digits.
  const re = new RegExp(`(?:^|[^0-9A-Za-z])(${D}{1,3})\\s?\\/\\s?(${D}{2,3})(?![0-9A-Za-z])`, 'g');
  for (const m of flat.matchAll(re)) {
    const num = fixDigits(m[1]);
    const total = parseInt(fixDigits(m[2]), 10);
    if (/^\d+$/.test(num) && total >= 10) {
      out.number = num;
      out.total = total;
      return out;
    }
  }

  // Scarlet & Violet / Mega Evolution promos: "SVP EN 085", "MEP 012"
  const newPromo = flat.match(new RegExp(`\\b(SVP|MEP)\\s*(?:EN)?\\s*(${D}{1,3})\\b`));
  if (newPromo) {
    out.setCode = newPromo[1];
    out.number = fixDigits(newPromo[2]);
    return out;
  }

  // Older black-star promos: "SWSH050", "SM60", "XY124", "BW50", "DP45", "HGSS01"
  const promo = flat.match(new RegExp(`\\b(SWSH|HGSS|SM|XY|BW|DP)\\s?(${D}{1,3})\\b`));
  if (promo) {
    out.number = `${promo[1]}${fixDigits(promo[2])}`;
    return out;
  }
  const alternatives = slashlessReadings(flat);
  if (alternatives.length) out.alternatives = alternatives;
  return out;
}

/** "HP 120", "120 HP", "HP120" → 120 (Pokémon HP is always a multiple of 10). */
export function parseHp(text: string): number | null {
  const m = text.match(new RegExp(`\\bHP\\s*(${D}{2,3})(?![0-9])|(?:^|[^0-9])(${D}{2,3})\\s*HP\\b`, 'i'));
  if (!m) return null;
  const hp = parseInt(fixDigits(m[1] ?? m[2]), 10);
  return hp >= 10 && hp <= 400 && hp % 10 === 0 ? hp : null;
}

export function buildGuess(topText: string, bottomText: string): ScanGuess {
  const bottom = parseBottomText(bottomText);
  return { names: parseNameText(topText), hp: parseHp(topText), ...bottom };
}
