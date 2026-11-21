/**
 * Every language of the interface (docs/I18N.md → The languages): the viewer, the admin, the Setup Assistant, the start
 * page and the API's error messages. The one list: the admin's and the start page's pickers show it, `check_i18n.py`
 * reads it (`UI_LOCALES`), `scripts/i18n/import_translations.py` accepts only its codes. Romanian (the source of every key)
 * and English (the fallback of every missing key) are bundled; every other language is fetched when first chosen.
 */
export const UI_LOCALES = [
    'ro',
    'en',
    'fr',
    'de',
    'es',
    'it',
    'pt',
    'pl',
    'ru',
    'uk',
    'tr',
    'ja',
    'zh',
    'ko',
    'ar',
    'hi',
    'nl',
    'hu',
    'id',
    'vi',
    'bn',
    'bg',
    'el',
    'fa',
    'ur',
] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/** The writing direction of a language: `dir` on `<html>` and on every shell that follows it. */
export type Direction = 'ltr' | 'rtl';

/** The two languages every page bundles: the source and the fallback. */
export const BUNDLED_LOCALES: readonly UiLocale[] = ['ro', 'en'];

/** The language a missing key falls back to (`docs/I18N.md` → Fallback). */
export const FALLBACK_LOCALE: UiLocale = 'en';

/** The languages written right to left: Arabic, Persian and Urdu. */
const RTL_LOCALES: ReadonlySet<UiLocale> = new Set<UiLocale>(['ar', 'fa', 'ur']);

/** Each language by its own name (an endonym: data, the same in every language). */
export const UI_LANGUAGE_NAMES: Readonly<Record<UiLocale, string>> = {
    ro: 'Română',
    en: 'English',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    it: 'Italiano',
    pt: 'Português',
    pl: 'Polski',
    ru: 'Русский',
    uk: 'Українська',
    tr: 'Türkçe',
    ja: '日本語',
    zh: '中文',
    ko: '한국어',
    ar: 'العربية',
    hi: 'हिन्दी',
    nl: 'Nederlands',
    hu: 'Magyar',
    id: 'Bahasa Indonesia',
    vi: 'Tiếng Việt',
    bn: 'বাংলা',
    bg: 'Български',
    el: 'Ελληνικά',
    fa: 'فارسی',
    ur: 'اردو',
};

/** The direction `locale` is written in. */
export function directionOf(locale: UiLocale): Direction {
    return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/** True for a code of {@link UI_LOCALES}. */
export function isUiLocale(value: unknown): value is UiLocale {
    return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

/** The interface language of a BCP 47 tag (`fr-CA`, `FA`), by its primary subtag, or undefined for any other. */
export function uiLocaleOf(tag: string | null | undefined): UiLocale | undefined {
    const language = (tag ?? '').trim().toLowerCase().replace(/-.*/s, '');
    return isUiLocale(language) ? language : undefined;
}

/**
 * The language of a city's own texts (`{ro, en}`) for a reader of `locale`: Romanian for Romanian, English for every other
 * language (the admin edits the two; a city's text in a third language is the viewer's `localized`).
 */
export function contentLocale(locale: UiLocale): 'ro' | 'en' {
    return locale === 'ro' ? 'ro' : 'en';
}

/** The pickers' order: by each language's own name in the root collation (Latin first), the same in every language. */
export const UI_LOCALES_BY_NAME: readonly UiLocale[] = UI_LOCALES.toSorted((a, b) =>
    new Intl.Collator('und').compare(UI_LANGUAGE_NAMES[a], UI_LANGUAGE_NAMES[b]),
);
