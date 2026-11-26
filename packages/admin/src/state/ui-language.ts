/**
 * The interface's languages beyond the two bundled ones (`docs/I18N.md` → Loading): each is one file of the build,
 * `i18n/<locale>.json` beside the page's module (`{locale, messages}`, every catalogue family of that language merged,
 * `scripts/site/src/ui-catalogues.ts`), fetched the first time it is chosen and added to `@hcm/shared`'s registry, which
 * every translator reads. The page switches only once the texts are here; a file that cannot be read leaves the language as
 * it was and says so. The admin and the start page share it.
 */
import { BUNDLED_LOCALES, FALLBACK_LOCALE, hasRegisteredCatalogue, isUiLocale, registerCatalogue, type UiLocale } from '@hcm/shared';

/** Resolves true once `locale`'s texts are here (at once for a bundled one), false when they could not be fetched. */
export type UiCatalogueLoader = (locale: UiLocale) => Promise<boolean>;

/** True for an object whose every value is a text. */
function isTexts(messages: unknown): messages is Readonly<Record<string, string>> {
    return typeof messages === 'object' && messages !== null && Object.values(messages).every((text) => typeof text === 'string');
}

/** The texts of a fetched file, or null when it is not `locale`'s file with a text for every value. */
export function messagesOf(file: unknown, locale: UiLocale): Readonly<Record<string, string>> | null {
    const { locale: named, messages } = (file ?? {}) as { locale?: unknown; messages?: unknown };
    return named === locale && isTexts(messages) ? messages : null;
}

async function fetchTexts(fetchFile: typeof fetch, url: string, locale: UiLocale): Promise<boolean> {
    try {
        const response = await fetchFile(url);
        const messages = response.ok ? messagesOf(await response.json(), locale) : null;
        if (messages !== null) {
            registerCatalogue(locale, messages);
        }
        return messages !== null;
    } catch {
        return false;
    }
}

/** True for a language every page carries (Romanian, English). */
export function isBundled(locale: UiLocale): boolean {
    return BUNDLED_LOCALES.includes(locale);
}

/** One request per language at a time; once it settles the registry answers, or the next choice of it tries again. */
export function uiCatalogueLoader(fetchFile: typeof fetch, folder: string): UiCatalogueLoader {
    const requests = new Map<UiLocale, Promise<boolean>>();
    return (locale) => {
        if (isBundled(locale) || hasRegisteredCatalogue(locale)) {
            return Promise.resolve(true);
        }
        const request =
            requests.get(locale) ??
            fetchTexts(fetchFile, `${folder}${locale}.json`, locale).finally(() => {
                requests.delete(locale);
            });
        requests.set(locale, request);
        return request;
    };
}

/** The language a page shows before `wanted`'s texts arrive: `wanted` when bundled, else English. */
export function firstShown(wanted: UiLocale): UiLocale {
    return isBundled(wanted) ? wanted : FALLBACK_LOCALE;
}

/** What a language switch needs: the loader, and what to do when the texts are here or could not be fetched. */
export interface LanguageSwitch {
    readonly load: UiCatalogueLoader;
    /** The texts are here: show the language and remember the choice. */
    apply(locale: UiLocale): void;
    /** They could not be fetched: the page keeps its language and says so. */
    unavailable(locale: UiLocale): void;
}

/**
 * Switches to `chosen` (any text; an unknown one is ignored) once its texts are here: at once for a language the page has
 * (bundled, or fetched before), after the fetch for any other.
 */
export async function switchLanguage(languageSwitch: LanguageSwitch, chosen: string): Promise<void> {
    if (!isUiLocale(chosen)) {
        return;
    }
    const here = isBundled(chosen) || hasRegisteredCatalogue(chosen);
    if (here || (await languageSwitch.load(chosen))) {
        languageSwitch.apply(chosen);
        return;
    }
    languageSwitch.unavailable(chosen);
}

/** {@link switchLanguage} where the latest choice wins: one switch per page, shared by its boot and its picker. */
export type LatestLanguage = (languageSwitch: LanguageSwitch, chosen: string) => Promise<void>;

/**
 * A page's language switch where the latest choice wins (as the viewer's, DECISIONS-for-review.md §195b): French chosen on
 * a slow network, then English (bundled, shown at once), stays English when the French file arrives; the boot's fetch of
 * the stored language never undoes a choice made in the picker meanwhile. A superseded switch neither shows, remembers nor
 * reports anything.
 */
export function latestLanguage(): LatestLanguage {
    let latest = 0;
    return (languageSwitch, chosen) => {
        if (!isUiLocale(chosen)) {
            return Promise.resolve();
        }
        latest += 1;
        const turn = latest;
        const current = (): boolean => turn === latest;
        return switchLanguage(
            {
                load: languageSwitch.load,
                apply: (locale) => {
                    if (current()) {
                        languageSwitch.apply(locale);
                    }
                },
                unavailable: (locale) => {
                    if (current()) {
                        languageSwitch.unavailable(locale);
                    }
                },
            },
            chosen,
        );
    };
}
