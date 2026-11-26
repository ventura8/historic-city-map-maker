/**
 * The editor areas' pages, each a lazy chunk (`DECISIONS-for-review.md` §34b): `AREA_CHUNKS` imports an area's chunk
 * (`../pages/<area>.ts`, one dynamic `import()` each, so the bundler splits them), and `areaPageLoader` makes the page
 * registry's loader of it: the area's store module joins the editors' modules (the content registry creates the store the
 * first time the page reads it), the page's elements are registered, and the page's tag goes to the shell. A chunk that
 * fails to load rejects the loader, which the shell's page outlet shows with Retry (`S-A29-BAD-CHUNK-LOAD`).
 */
import type { ContentArea, ContentModules } from '../content/areas.js';
import type { AreaChunk } from './area-chunk.js';
import type { PageLoader } from './pages.js';

/** Each area's chunk, imported on first use. */
export type AreaChunkLoaders = { readonly [Area in ContentArea]: () => Promise<AreaChunk<Area>> };

export const AREA_CHUNKS: AreaChunkLoaders = {
    photos: async () => (await import('../pages/photos.js')).AREA,
    pois: async () => (await import('../pages/pois.js')).AREA,
    layers: async () => (await import('../pages/layers.js')).AREA,
    settings: async () => (await import('../pages/settings.js')).AREA,
    admins: async () => (await import('../pages/admins.js')).AREA,
    history: async () => (await import('../pages/history.js')).AREA,
    jobs: async () => (await import('../pages/jobs.js')).AREA,
    crashes: async () => (await import('../pages/crashes.js')).AREA,
    home: async () => (await import('../pages/home.js')).AREA,
    imagery: async () => (await import('../pages/imagery.js')).AREA,
    georef: async () => (await import('../pages/georef.js')).AREA,
    help: async () => (await import('../pages/help.js')).AREA,
    inbox: async () => (await import('../pages/inbox.js')).AREA,
    cities: async () => (await import('../pages/cities.js')).AREA,
    review: async () => (await import('../pages/review.js')).AREA,
    contribute: async () => (await import('../pages/contribute.js')).AREA,
    stories: async () => (await import('../pages/stories.js')).AREA,
};

/** The editors' modules the entry hands the content registry, filled as each area's chunk arrives. */
export type ContentModuleSlots = { -readonly [Area in keyof ContentModules]: ContentModules[Area] };

/** The page registry's loader of `area`: loads its chunk, adds its store module to `slots`, registers its elements. */
export function areaPageLoader<Area extends ContentArea>(
    area: Area,
    load: () => Promise<AreaChunk<Area>>,
    slots: ContentModuleSlots,
    registry: () => CustomElementRegistry,
): PageLoader {
    return async () => {
        const chunk = await load();
        (slots as Partial<Record<Area, AreaChunk<Area>['module']>>)[area] = chunk.module;
        chunk.elements.define(registry());
        return chunk.elements.tag;
    };
}
