import { en } from './en.js';
import { directionOf, UI_LANGUAGE_NAMES, UI_LOCALES, UI_LOCALES_BY_NAME, type UiLocale } from './locales.js';
import { fillPlaceholders, hasRegisteredCatalogue, registeredText, uiText } from './registry.js';
import { ro, type MessageKey } from './ro.js';

export type { MessageKey, Messages } from './ro.js';
export {
    familyLanguage,
    fillPlaceholders,
    hasRegisteredCatalogue,
    registerCatalogue,
    textLanguage,
    uiText,
    type BundledTexts,
} from './registry.js';

/** The languages of the admin and of a city's own texts (`{ro, en}`): Romanian, the source, and English. */
export const LOCALES = ['ro', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The public viewer's languages (docs/ENGINE_API.md → Language): every interface language of `locales.ts`, Romanian the
 * default and the source of every key. The engine bundles none of their catalogues: each is fetched once, when first shown,
 * from `i18n/<locale>.json` next to the engine (`docs/research/DECISIONS-for-review.md` §218); a language whose file lacks a
 * key shows it in English (§219).
 */
export const VIEWER_LOCALES = UI_LOCALES;

export type ViewerLocale = UiLocale;

/** Romanian is the default for every visitor whose language is not explicitly another one. */
export const DEFAULT_LOCALE: Locale = 'ro';

/**
 * The viewer's main catalogues this page bundles: Romanian and English imported (the admin, the tests). The engine's build
 * replaces the two imports with empty stand-ins, so it registers every language it fetches (`registry.ts`).
 */
const MAIN: Readonly<Partial<Record<UiLocale, Readonly<Record<string, string>>>>> = { ro, en };

/** The viewer language of a BCP 47 tag (`de-AT`, `zh-TW`, `EN`), by its primary subtag, or undefined for any other. */
export function viewerLocaleOf(tag: string | null | undefined): ViewerLocale | undefined {
    const language = (tag ?? '').trim().toLowerCase().replace(/-.*/s, '');
    return VIEWER_LOCALES.find((locale) => locale === language);
}

/** The viewer language of a tag, falling back to {@link DEFAULT_LOCALE}. */
export function resolveViewerLocale(tag: string | null | undefined): ViewerLocale {
    return viewerLocaleOf(tag) ?? DEFAULT_LOCALE;
}

/** Maps a tag to the admin's two languages: English stays English, anything else becomes {@link DEFAULT_LOCALE}. */
export function resolveLocale(tag: string | null | undefined): Locale {
    return viewerLocaleOf(tag) === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** True for a language written right to left (Arabic, Persian, Urdu: `directionOf`). */
export function isRtl(locale: UiLocale): boolean {
    return directionOf(locale) === 'rtl';
}

/** True once `locale`'s texts are here: the viewer renders no text before. */
export function hasCatalogue(locale: UiLocale): boolean {
    return MAIN[locale] !== undefined || hasRegisteredCatalogue(locale);
}

/** One text of `locale`'s catalogue by any key (the map labels' family is in the same fetched file), or undefined. */
export function catalogueText(locale: UiLocale, key: string): string | undefined {
    return MAIN[locale]?.[key] ?? registeredText(locale, key);
}

/**
 * A viewer language whose file has not arrived gives an empty text (it will come; the viewer renders none before);
 * any other language falls back to English per missing key.
 */
function mainText(locale: UiLocale, key: string): string {
    const pending = viewerLocaleOf(locale) === locale && !hasCatalogue(locale);
    return pending ? '' : (uiText(locale, key, MAIN) ?? '');
}

/**
 * Translates `key` and fills `{name}` placeholders from `params`; unknown placeholders are left visible. A locale whose
 * catalogue is not here yet gives an empty text, never a raw key. In a right-to-left language each value is isolated
 * (U+2068 … U+2069, `fillPlaceholders`), so a Latin layer name keeps its own order inside the Arabic sentence.
 */
export function translate(locale: UiLocale, key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    return fillPlaceholders(mainText(locale, key), params, locale);
}

/**
 * Each viewer language by its own name (`UI_LANGUAGE_NAMES`, the one table), in the order the language list shows them:
 * the root collation's (`UI_LOCALES_BY_NAME`, Latin first), so the list never reorders when the page's language changes.
 */
export const LANGUAGE_NAMES = Object.fromEntries(UI_LOCALES_BY_NAME.map((locale) => [locale, UI_LANGUAGE_NAMES[locale]])) as Readonly<
    Record<ViewerLocale, string>
>;

/** The tags `Intl` formats with where the bare code would not do: the owner's photo dates (`en` alone would write `July 12, 1936`), Latin digits in Arabic, Persian and Bengali (as the timeline's years). */
const INTL_TAGS: Partial<Record<UiLocale, string>> = {
    ro: 'ro-RO',
    en: 'en-GB',
    ar: 'ar-u-nu-latn',
    fa: 'fa-u-nu-latn',
    bn: 'bn-u-nu-latn',
};

/** The `Intl` tag of an interface language. */
export function intlTag(locale: UiLocale): string {
    return INTL_TAGS[locale] ?? locale;
}

/** A city's own text (`{ro, en?}`, a name, a caption, About): Romanian always, English often, other languages maybe. */
export type CityText = { readonly ro: string } & Partial<Readonly<Record<ViewerLocale, string | undefined>>>;

/**
 * The language a city's text is shown in for a visitor reading `locale` (docs/ENGINE_API.md → Language): its own, else
 * English, else Romanian, the source every text has. The element showing it takes this as its `lang`.
 */
export function shownLanguage(text: CityText, locale: ViewerLocale): ViewerLocale {
    if (text[locale] !== undefined) {
        return locale;
    }
    return text.en === undefined ? 'ro' : 'en';
}

/** A city's text in `locale`, falling back as {@link shownLanguage} says. */
export function localized(text: CityText, locale: ViewerLocale): string {
    return text[shownLanguage(text, locale)] ?? text.ro;
}
