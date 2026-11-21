import type { Plugin } from 'vite';

/**
 * The viewer's catalogues out of the engine's bundle (`docs/research/DECISIONS-for-review.md` §218, docs/ENGINE_API.md →
 * Language). The engine's build:
 *
 * - resolves the two catalogues `@hcm/shared` imports (`packages/shared/src/i18n/ro.ts`, `en.ts` and their `map-labels/`
 *   files) to an empty stand-in, so the bundle carries no catalogue at all: about 5 KB gzip of the IIFE;
 * - writes every viewer language's texts (`VIEWER_CATALOGUES`) to `i18n/<locale>.json` next to `engine.mjs`, where the
 *   engine fetches the one it shows, the folder its `fonts/` are in (jsDelivr's release folder, Hosting's, the export's).
 *
 * A file is `{"engine": "<version>", "locale": "<code>", "messages": {…}}`, its keys sorted; the engine takes it only when
 * both match (`packages/engine/src/core/catalogues.ts`). A language still being translated (a key of Romanian it lacks)
 * also says `"fallback": "en"`: the engine then fetches English too, which shows each missing key (docs/I18N.md → Fallback).
 */

/** One language's texts as `VIEWER_CATALOGUES` holds them (a language being translated lacks some keys). */
export type CatalogueTexts = Readonly<Partial<Record<string, string>>>;

/** The four catalogue modules `@hcm/shared` imports, by their path. */
const BUNDLED = /[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/](?:map-labels[\\/])?(ro|en)\.ts$/;

/** The stand-in of a bundled catalogue module (its export, undefined), or null for any other module. */
export function catalogueStandIn(id: string): string | null {
    const match = BUNDLED.exec(id.split('?')[0] ?? id);
    return match === null ? null : `export const ${String(match[1])} = undefined;\n`;
}

/** One language's file, as the engine fetches it. */
export function catalogueFile(engine: string, locale: string, messages: CatalogueTexts, partial = false): string {
    const present = Object.entries(messages).filter((entry): entry is [string, string] => entry[1] !== undefined);
    const sorted = Object.fromEntries(present.toSorted(([a], [b]) => (a < b ? -1 : 1)));
    return JSON.stringify({ engine, locale, messages: sorted, ...(partial ? { fallback: 'en' } : {}) });
}

/** True when `messages` lacks a key of `source` (Romanian's): the file names English as its fallback. */
export function isPartial(messages: CatalogueTexts, source: CatalogueTexts): boolean {
    return Object.keys(source).some((key) => messages[key] === undefined);
}

/** The folder of the files next to the engine. */
export const CATALOGUE_FOLDER = 'i18n';

/** The Vite plugin of the engine's build: the stand-ins while bundling, the files once the bundle is written. */
export function i18nCataloguesPlugin(engineVersion: string, catalogues: Readonly<Record<string, CatalogueTexts>>): Plugin {
    const source = catalogues['ro'] ?? {};
    return {
        name: 'hcm-i18n-catalogues',
        enforce: 'pre',
        load: (id) => catalogueStandIn(id),
        generateBundle() {
            for (const [locale, messages] of Object.entries(catalogues)) {
                this.emitFile({
                    type: 'asset',
                    fileName: `${CATALOGUE_FOLDER}/${locale}.json`,
                    source: catalogueFile(engineVersion, locale, messages, isPartial(messages, source)),
                });
            }
        },
    };
}
