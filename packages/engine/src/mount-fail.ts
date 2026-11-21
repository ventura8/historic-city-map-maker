/**
 * A viewer that could not boot (docs/ENGINE_API.md → Errors and validation, Language): its error card, worded in the
 * boot's language once that language's texts are here (else in Romanian, else as the engine's own bilingual card), and a
 * controller whose `ready` says why at once.
 */
import { hasCatalogue, resolveViewerLocale, type EngineConfig, type ViewerLocale } from '@hcm/shared';
import type { HcmMapViewer, ViewerController, ViewerError } from '@hcm/ui';

import { urlLocaleOf } from './core/boot.js';
import { firstCatalogue, presentCatalogue, type CatalogueLoader } from './core/catalogues.js';

/** A viewer that could not boot: `ready` says why at once, every call does nothing, `destroy` removes the card. */
function failedController(code: ViewerError['code'], teardown: () => void): ViewerController {
    let removed = false;
    const ignore = (): void => undefined;
    return {
        ready: Promise.resolve({ ok: false, code }),
        setYear: ignore,
        toggleLayer: ignore,
        setOverlayOpacity: ignore,
        openPhoto: ignore,
        openPoi: ignore,
        setLang: ignore,
        openCompare: ignore,
        setComparePosition: ignore,
        closeCompare: ignore,
        setMapLabels: ignore,
        destroy: () => {
            if (!removed) {
                removed = true;
                teardown();
            }
        },
    };
}

/** What a failed boot shows: the error in a language (an invalid configuration's detail is translated), and where. */
export interface BootFailure {
    readonly errorIn: (locale: ViewerLocale) => ViewerError;
    /** The boot's language: the address's, else the configuration's. */
    readonly locale: ViewerLocale;
    /** The languages' texts (none: only the languages the page has, the node tests). */
    readonly catalogues: CatalogueLoader | undefined;
}

/**
 * Shows the error in `viewer`'s card (the card follows the element's `lang`) once the boot language's texts are here, at
 * once when they are, and returns the controller of a viewer that could not boot.
 */
export function failBoot(viewer: HcmMapViewer, failure: BootFailure): ViewerController {
    const { errorIn, locale } = failure;
    const show = (shown: ViewerLocale | null): void => {
        viewer.setAttribute('lang', shown ?? locale);
        viewer.bootError = errorIn(shown ?? locale);
    };
    if (hasCatalogue(locale)) {
        show(locale);
    } else {
        void firstCatalogue(failure.catalogues ?? presentCatalogue, locale).then(show);
    }
    return failedController(errorIn(locale).code, () => {
        viewer.remove();
    });
}

/** The language of a configuration before validation (for its own error message). */
export function languageOf(raw: unknown): ViewerLocale {
    const lang = typeof raw === 'object' && raw !== null ? (raw as { readonly lang?: unknown }).lang : undefined;
    return resolveViewerLocale(typeof lang === 'string' ? lang : undefined);
}

/** Where the page's address is read and the languages' texts are fetched (`MountEnvironment`'s part a boot error needs). */
export interface BootLocaleSource {
    readonly location: Parameters<typeof urlLocaleOf>[0];
    readonly catalogues?: ((engineBase: string | undefined) => CatalogueLoader) | undefined;
}

/**
 * The language of a boot error card (docs/ENGINE_API.md → Language): the page address first, then the configuration's
 * own `lang`, so a city owner who opened `?lang=en` reads the whole card in English.
 */
export function bootLocale(configLocale: ViewerLocale, env: Pick<BootLocaleSource, 'location'>): ViewerLocale {
    return urlLocaleOf(env.location) ?? configLocale;
}

/** Mapbox GL JS is missing from the page: the card says the map could not load, in the boot's language. */
export function withoutMapbox(viewer: HcmMapViewer, config: EngineConfig, env: BootLocaleSource): ViewerController {
    const error: ViewerError = { code: 'error.mapLoad', retryable: false };
    const locale = bootLocale(resolveViewerLocale(config.lang), env);
    return failBoot(viewer, { errorIn: () => error, locale, catalogues: env.catalogues?.(config.engineBase) });
}
