/**
 * The viewer's languages, fetched when first shown (docs/ENGINE_API.md → Language; DECISIONS-for-review.md §218): the
 * engine bundles no catalogue, each language is `<engineBase>i18n/<locale>.json`, the folder its fonts are in. A file is
 * taken only when it names this engine's version and the language asked for and every value is a text; then it joins
 * `@hcm/shared`'s registry, which `translate` reads, for the page's life. No SRI: the file comes from the same
 * version-pinned folder as the SRI-checked engine (immutable on jsDelivr), as the fonts do, and every value is rendered as
 * text only. The request is the manifest's (`fetchManifestJson`: its timeout, a network error or a 5xx retried twice).
 * A language still being translated says `"fallback": "en"`: English is fetched with it, and shows each key it lacks
 * (docs/I18N.md → Fallback).
 */
import { hasCatalogue, registerCatalogue, type ViewerLocale } from '@hcm/shared';

import { fetchManifestJson, type ManifestFetch } from '../config/load.js';

/** Resolves true once `locale`'s texts are here (at once when they are), false when they could not be fetched. */
export type CatalogueLoader = (locale: ViewerLocale) => Promise<boolean>;

export interface CatalogueSource {
    readonly fetch: ManifestFetch;
    /** The folder of the files: `<engineBase>i18n/`. */
    readonly folder: string;
    /** `ENGINE_VERSION`: a file of another engine is refused. */
    readonly engineVersion: string;
    readonly timeoutMs?: number;
    readonly retryDelaysMs?: readonly number[];
}

/** A language without a loader is only the one this page already has (the node tests: Romanian and English). */
export const presentCatalogue: CatalogueLoader = (locale) => Promise.resolve(hasCatalogue(locale));

/** True for an object whose every value is a text. */
function isTexts(messages: unknown): messages is Readonly<Record<string, string>> {
    return typeof messages === 'object' && messages !== null && Object.values(messages).every((text) => typeof text === 'string');
}

interface CatalogueFile {
    readonly engine?: unknown;
    readonly locale?: unknown;
    readonly messages?: unknown;
    readonly fallback?: unknown;
}

/** The texts of a fetched file, or null when it is not this engine's file of `locale` with a text for every value. */
function messagesOf(file: CatalogueFile, locale: ViewerLocale, engineVersion: string): Readonly<Record<string, string>> | null {
    const { engine, locale: named, messages } = file;
    return engine === engineVersion && named === locale && isTexts(messages) ? messages : null;
}

/** The fetched file's fields (none when it could not be read). */
async function fetchFile(url: string, source: CatalogueSource): Promise<CatalogueFile> {
    const json = await fetchManifestJson(url, source);
    return json.ok ? (json.value ?? {}) : {};
}

/** Registers `locale`'s file; a partial one (`fallback: "en"`) only once English, which fills its gaps, is here too. */
async function fetchCatalogue(locale: ViewerLocale, source: CatalogueSource, load: CatalogueLoader): Promise<boolean> {
    const file = await fetchFile(`${source.folder}${locale}.json`, source);
    const messages = messagesOf(file, locale, source.engineVersion);
    const ready = messages !== null && (file.fallback !== 'en' || (await load('en')));
    if (ready) {
        registerCatalogue(locale, messages);
    }
    return ready;
}

/** One request per language at a time; once it settles the registry answers, or the next choice of it tries again. */
export function catalogueLoader(source: CatalogueSource): CatalogueLoader {
    const requests = new Map<ViewerLocale, Promise<boolean>>();
    const load: CatalogueLoader = (locale) => {
        if (hasCatalogue(locale)) {
            return Promise.resolve(true);
        }
        const request =
            requests.get(locale) ??
            fetchCatalogue(locale, source, load).finally(() => {
                requests.delete(locale);
            });
        requests.set(locale, request);
        return request;
    };
    return load;
}

/** The first language of `locale` and Romanian whose texts load (the boot's and a boot error's), or null when neither does. */
export async function firstCatalogue(load: CatalogueLoader, locale: ViewerLocale): Promise<ViewerLocale | null> {
    if (await load(locale)) {
        return locale;
    }
    return locale !== 'ro' && (await load('ro')) ? 'ro' : null;
}
