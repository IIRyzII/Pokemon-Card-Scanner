// The languages a copy can be printed in: the European printings of the international sets, which
// share the English cards' set and number (so they're the same catalog card). Japanese, Korean and
// Chinese cards come from their own sets, so they aren't offered.
//
// Neither price source tells languages apart: TCGplayer only sells English copies, and Cardmarket
// (where the European languages trade) gives one price for a card in any language.

export const LANGUAGES = {
  en: { label: 'English', short: 'EN' },
  fr: { label: 'French', short: 'FR' },
  de: { label: 'German', short: 'DE' },
  it: { label: 'Italian', short: 'IT' },
  es: { label: 'Spanish', short: 'ES' },
  pt: { label: 'Portuguese', short: 'PT' },
} as const;
export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];
export const DEFAULT_LANGUAGE: Language = 'en';

export const languageLabel = (code: string | null | undefined) => LANGUAGES[(code ?? 'en') as Language]?.label ?? code ?? 'English';
