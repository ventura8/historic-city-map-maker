import { fillKitPage, KitPageError, type EngineRelease } from '@hcm/shared';

import { ReleaseError } from './files.js';

/**
 * The starter kit's pins (`docs/research/M5-interfaces.md` §2.6, §3.2): after `npm run release:cdn`, the template's
 * engine block and meta CSP are rewritten from `cdn/engine/release.json` through `fillKitPage` (the one function that
 * knows the page's slots, shared with `create-historic-city` and the static export), so the page loads exactly that
 * release's `engine.css` and `engine.iife.js` with their integrity. Mapbox GL JS's tags are the template's own; they
 * must already pin what the release names (a newer Mapbox GL JS is a template change), which the `kit-pins` gate checks
 * too.
 */

export const KIT_TEMPLATE = 'templates/starter-kit/index.html';

/** `template` pinned to `release`; a template without its slots, or with other Mapbox GL JS pins, is refused. */
export function pinKitPage(template: string, release: EngineRelease): string {
    let page: string;
    try {
        page = fillKitPage(template, { engine: { kind: 'cdn', release } });
    } catch (error: unknown) {
        if (error instanceof KitPageError) {
            throw new ReleaseError(`${KIT_TEMPLATE}: ${error.message}`);
        }
        throw error;
    }
    const mapbox = [release.mapboxGl.stylesheet, release.mapboxGl.script];
    const unpinned = mapbox.filter((resource) => !page.includes(`"${resource.url}"`) || !page.includes(`"${resource.integrity}"`));
    if (unpinned.length > 0) {
        const names = unpinned.map((resource) => `${resource.url} (${resource.integrity})`).join(', ');
        throw new ReleaseError(`${KIT_TEMPLATE} does not pin Mapbox GL JS as release ${release.version} does: ${names}`);
    }
    return page;
}
