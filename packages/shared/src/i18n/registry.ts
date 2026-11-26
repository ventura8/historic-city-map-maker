import { createLogger } from '../log.js';
import { BUNDLED_LOCALES, directionOf, FALLBACK_LOCALE, type UiLocale } from './locales.js';

/**
 * The languages fetched once chosen (`docs/I18N.md` → Loading): the engine's, the admin's and the start page's files join
 * this registry, which every translator reads after its family's bundled Romanian and English. A module of its own, with
 * no catalogue in it, so a page that bundles one family (the start page) never bundles the viewer's.
 */
const REGISTERED: Partial<Record<UiLocale, Readonly<Record<string, string>>>> = {};

/** One catalogue per bundled language of a family (`{ro, en}`; the engine's build empties both). */
export type BundledTexts = Partial<Readonly<Record<UiLocale, Readonly<Record<string, string>> | undefined>>>;

const LOG = createLogger('i18n');

/** The languages whose first missing key was logged: one line per language and page, not one per key. */
const FELL_BACK = new Set<UiLocale>();

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Adds a fetched catalogue (the engine's loader, the admin's and the start page's, after checking it). A second file of the
 * same language adds its keys to the first.
 */
export function registerCatalogue(locale: UiLocale, messages: Readonly<Record<string, string>>): void {
    REGISTERED[locale] = { ...REGISTERED[locale], ...messages };
}

/** True once a file of `locale` has been registered. */
export function hasRegisteredCatalogue(locale: UiLocale): boolean {
    return REGISTERED[locale] !== undefined;
}

/** One text of a registered file, or undefined. */
export function registeredText(locale: UiLocale, key: string): string | undefined {
    return REGISTERED[locale]?.[key];
}

/** One line per language and page, naming the first key it lacked. */
function logFallback(locale: UiLocale, key: string): void {
    if (locale === FALLBACK_LOCALE || FELL_BACK.has(locale)) {
        return;
    }
    FELL_BACK.add(locale);
    LOG.warn('a text is missing in this language: English shown instead', { locale, key });
}

/** The English text of `key` for a language that lacks it, logged once per language (`docs/I18N.md` → Fallback). */
function fallbackText(locale: UiLocale, key: string, bundled: BundledTexts): string | undefined {
    const english = bundled[FALLBACK_LOCALE]?.[key] ?? registeredText(FALLBACK_LOCALE, key);
    if (english !== undefined) {
        logFallback(locale, key);
    }
    return english;
}

/**
 * The text of `key` in `locale`: the family's bundled catalogue (Romanian, English), else the registry (a fetched
 * language), else English, logged once per language; undefined only when English lacks it too.
 */
export function uiText(locale: UiLocale, key: string, bundled: BundledTexts = {}): string | undefined {
    return bundled[locale]?.[key] ?? registeredText(locale, key) ?? fallbackText(locale, key, bundled);
}

/**
 * Fills `{name}` placeholders from `params`; unknown placeholders are left visible. For a right-to-left `locale` (Arabic,
 * Persian, Urdu) each value is isolated (U+2068 … U+2069), so a Latin city or layer name keeps its own order inside the
 * sentence: the viewer's `translate`, every admin family's translator and the API's errors fill the same way.
 */
export function fillPlaceholders(text: string, params: Readonly<Record<string, string>>, locale?: UiLocale): string {
    const [open, close] = locale !== undefined && directionOf(locale) === 'rtl' ? ['\u2068', '\u2069'] : ['', ''];
    return text.replace(PLACEHOLDER, (placeholder: string, name: string) => {
        const value = params[name];
        return value === undefined ? placeholder : open + value + close;
    });
}

/**
 * The language `key`'s text shows in for a reader of `locale`: `locale` when it has the text (Romanian and English have
 * every key, `check_i18n.py`), else English, the fallback. An element showing a fallback text names it with this `lang`
 * (WCAG 3.1.2), so a screen reader reads English words with an English voice inside an Arabic page.
 */
export function textLanguage(locale: UiLocale, key: string): UiLocale {
    return BUNDLED_LOCALES.includes(locale) || registeredText(locale, key) !== undefined ? locale : FALLBACK_LOCALE;
}

/** The language a family's texts (its keys starting with `prefix`) show in: `locale` once its file holds any of them, else English. */
export function familyLanguage(locale: UiLocale, prefix: string): UiLocale {
    const texts = REGISTERED[locale] ?? {};
    const has = BUNDLED_LOCALES.includes(locale) || Object.keys(texts).some((key) => key.startsWith(prefix));
    return has ? locale : FALLBACK_LOCALE;
}
