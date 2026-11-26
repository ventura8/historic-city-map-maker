/**
 * The page's extras loader (`loader.ts`): one per release's entry on the host (`host.ts`; the build names the entry in
 * each extra it lists, `ExtraFile.host`), created the first time one of its extras is wanted, with the engine's folder
 * `index.ts` gives it (`setExtrasBase`). The builds' generated `imports.ts` calls `loadExtra`
 * (`scripts/site/src/engine-extras.ts`).
 */
import { createLogger } from '@hcm/shared';

import { installExtrasHost } from './host.js';
import { createExtraLoader, type ExtraFile, type ExtraLoader } from './loader.js';

let base = '';
const loaders = new Map<string, ExtraLoader>();

/** The folder the extras are loaded from: the engine script's (`engineBaseOf`). */
export function setExtrasBase(folder: string): void {
    base = folder;
}

function pageLoader(scope: typeof globalThis, key: string): ExtraLoader {
    const host = installExtrasHost(scope, key);
    return createExtraLoader<HTMLScriptElement>({
        document: scope.document,
        base: () => base,
        registry: () => host.extras,
        ready: () => host.ready,
        log: createLogger('engine').child('extras'),
    });
}

/** Loads one extra of the build, once (`loader.ts`). */
export function loadExtra(extra: ExtraFile): Promise<unknown> {
    let loader = loaders.get(extra.host);
    if (loader === undefined) {
        loader = pageLoader(globalThis, extra.host);
        loaders.set(extra.host, loader);
    }
    return loader(extra);
}
