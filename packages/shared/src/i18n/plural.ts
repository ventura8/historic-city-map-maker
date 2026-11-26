import type { UiLocale } from './locales.js';

/**
 * The plural form the catalogues spell out for `count`: `one`, `few` (Romanian's 0 and 2–19, where English says `other`)
 * or `other` (Romanian's 20 and more, which take "de": "20 de dispozitive"). A key with a count has the three forms in
 * both languages (`….one`, `….few`, `….other`), so a text never says "1 devices" or "1 necitite".
 */
export function pluralOf(locale: UiLocale, count: number): 'one' | 'few' | 'other' {
    const rule = new Intl.PluralRules(locale).select(count);
    return rule === 'one' || rule === 'few' ? rule : 'other';
}
